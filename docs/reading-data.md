# Reading data

How models become resources, and how the read-side query parameters (`include`, `fields`,
`sort`, `page`, `filter`) behave.

## Resources and types

Every Lucid model can serialize as a JSON:API resource with zero configuration. The defaults
come from the model's own metadata:

- **type** is the kebab-cased table name (`users`, `articles`, `access-tokens`)
- **id** is the primary key, converted to a string (the spec requires string ids)
- **attributes** are the serializable columns, minus the primary key and any belongsTo
  foreign keys (those are represented as relationships instead). `serializeAs` is respected,
  and columns marked `serializeAs: null`, like password hashes, never appear.
- **relationships** are the relations defined on the model

## Customizing a resource

Create a resource class when you want control over any of the defaults, and register it in
`config/jsonapi.ts`:

```ts
// app/resources/user_resource.ts
import User from '#models/user'
import { JsonApiResource } from 'jsonapi-adonis'

export default class UserResource extends JsonApiResource<User> {
  static model = () => User
}
```

```ts
// config/jsonapi.ts
export default defineConfig({
  resources: [() => import('#resources/user_resource')],
})
```

That class above is already valid. `static model` is the only required member; registering
without it throws, and everything else falls back to the auto-derived behavior. Inside any
instance method, `this.resource` is the Lucid model instance being serialized (typed by the
generic) and `this.ctx` is the current HttpContext when serialization happens inside a
request, or `undefined` outside one.

Why is `static model` required when serialization itself doesn't need a resource class? The
registry is a map from model class to resource class: serialization starts from a Lucid row,
so the model is always the known side, and auto-derivation is just what happens on a map
miss. Registering a class means filing it under a key, and `static model` is that key.
Without the key the class would be unreachable, so the registry fails loudly instead
of silently ignoring a resource you wrote.

Every claim in this section is pinned by
[`tests/unit/resource_customization.spec.ts`](../tests/unit/resource_customization.spec.ts).
If the docs and the code ever disagree, that suite fails.

Here is the full surface:

| Member                       | Required | Default                                                              |
| ---------------------------- | -------- | -------------------------------------------------------------------- |
| `static model`               | Yes      | none, the registry throws without it                                 |
| `static type`                | No       | kebab-cased table name (`access_tokens` → `access-tokens`)           |
| `static exposeRelationships` | No       | every relation on the model                                          |
| `static filters`             | No       | none, all `?filter[...]` requests get a 400                          |
| `id()`                       | No       | the primary key, as a string                                         |
| `attributes()`               | No       | serializable columns minus pk, belongsTo FKs and `serializeAs: null` |
| `links()`                    | No       | nothing extra, the generated `self` link stands alone                |
| `meta()`                     | No       | no `meta` member                                                     |

### `static type`

Overrides the resource type everywhere the model appears: primary data, linkage pointers,
`included`, and the type clients must send in write requests.

```ts
export default class UserResource extends JsonApiResource<User> {
  static model = () => User
  static type = 'people'
}
```

### `id()`

The default returns the primary key as a string. Override it to expose a different public
identity, a slug or a prefixed id for example. The override is honoured everywhere: `data.id`,
relationship linkage, and `included` all agree, because dedup and pointers go through the
same method.

```ts
id() {
  return `u-${this.resource.id}`
}
```

Note the id is identity, not decoration. If you override it on a resource that has write
endpoints, clients will send this id back and your controllers must be able to look records
up by it.

### `attributes()`

The default returns every serializable column except the primary key (already in `id`),
belongsTo foreign keys (already in `relationships`), and anything marked
`serializeAs: null`. Override it to curate the set. `this.pick([...])` selects columns by
their serialized names, and computed values are plain properties:

```ts
attributes() {
  return {
    ...this.pick(['fullName', 'email']),
    initials: this.resource.initials,
  }
}
```

Sparse fieldsets (`?fields[type]=`) filter whatever this method returns, so computed
attributes participate like any other.

### `links()`

Whatever you return is merged over the generated links, which means you can add links or
replace the generated `self`:

```ts
links() {
  return { canonical: `https://example.com/u/${this.resource.id}` }
}
```

The generated `self` survives alongside your additions. Return a `self` key yourself and it
wins over the generated one.

### `meta()`

Attach per-resource metadata. Returning `undefined` or an empty object omits the `meta`
member entirely, so it's safe to make it conditional:

```ts
meta() {
  return { isOwn: this.ctx?.auth?.user?.id === this.resource.id }
}
```

### `static exposeRelationships`

By default every relation defined on the model appears as a relationship member. List the
ones you want to expose and the rest disappear from documents:

```ts
static exposeRelationships = ['author', 'tags']
```

One wrinkle to know about: `?include=` validation checks the model's relations, not this
list. Asking to include a hidden relation is therefore not a 400. The request succeeds and
the hidden relation simply contributes nothing, neither a relationship member nor `included`
entries.

### `static filters`

Declares the `?filter[...]` parameters this resource accepts. Nothing is filterable without
it. Covered in depth in [Filtering](#filtering) below.

## Relationships and included data

Clients ask for related resources with the `include` parameter. Paths can be nested with
dots and combined with commas:

```
GET /api/v1/articles/1?include=author,comments.author,tags
```

The package validates every path against the model's relations (unsupported paths are a
`400` with `source: { parameter: "include" }`, per spec), preloads the whole tree in one
pass to avoid N+1 queries, and flattens the results into `included`, deduplicated by
`(type, id)`. If the same user wrote the article and three of its comments, they appear
once. Each resource's `relationships` member carries the `{ type, id }` linkage.

A couple of behaviors deserve a mention:

- A `belongsTo` relationship gets linkage even without preloading. The foreign key already
  holds the answer, at zero query cost.
- An unloaded to-many relationship is never reported as empty. It appears with `links` only,
  because `data: []` would be a lie. The spec distinguishes "empty" from "not loaded", and
  the client can follow the link to find out.

All Lucid relation kinds serialize: `belongsTo` and `hasOne` as to-one, `hasMany`,
`manyToMany` and `hasManyThrough` as to-many.

## Sparse fieldsets

Clients can trim responses per resource type. `fields[<type>]` lists the fields to keep, and
per the spec it applies to attributes _and_ relationships:

```
GET /api/v1/articles/1?include=author&fields[articles]=title,author&fields[users]=fullName
```

Returns articles with only a `title` attribute and `author` relationship, and included users
with only `fullName`.

## Sorting and pagination

```
GET /api/v1/articles?sort=-createdAt,title&page[number]=2&page[size]=10
```

- `sort` accepts comma-separated attribute names. A `-` prefix means descending. Names are
  matched against serialized attribute names and mapped to the underlying columns; unknown
  fields are a `400`.
- `page[number]` and `page[size]` map to Lucid's paginator via `jsonApi.page`. Paginated
  responses carry `first`, `prev`, `next` and `last` links (which preserve your other query
  parameters, per spec) and a `meta.page` object with totals.

## Filtering

The spec reserves `filter[...]` but leaves its meaning to the server. This package takes a
strict, declarative stance: nothing is filterable unless the resource says so. Declare
filters on the resource class:

```ts
import { JsonApiResource, filter } from 'jsonapi-adonis'

export default class ArticleResource extends JsonApiResource<Article> {
  static type = 'articles'
  static model = () => Article

  static filters = {
    // ?filter[title]=Hello        → where('title', 'Hello')
    // ?filter[title]=a,b          → whereIn('title', ['a', 'b'])
    title: filter.eq(),

    // Map a public name to an attribute + operator.
    // gt / gte / lt / lte are all available.
    // ?filter[publishedAfter]=2026-01-01 → where('created_at', '>=', …)
    publishedAfter: filter.gte('createdAt'),
    publishedBefore: filter.lte('createdAt'),

    // Filter by a belongsTo relationship's id:
    // ?filter[author]=7 → where('author_id', 7)
    author: filter.relation('author'),

    // Full control: you get the Lucid query builder and the raw value
    search: filter.custom((query, value) => {
      query.where((q) => q.whereILike('title', `%${value}%`).orWhereILike('body', `%${value}%`))
    }),
  }
}
```

The rules:

- An undeclared filter name is a `400` with `source: { parameter: "filter[name]" }`. This is
  the same strict-input policy as `include` and `sort`. A resource with no `filters` rejects
  all filtering, and clients can never probe arbitrary columns.
- Attribute names in `filter.eq()` and the comparison filters are serialized names, mapped
  to database columns for you. They default to the filter's own key, hence the bare
  `filter.eq()`.
- Comma-separated values become `whereIn` for `eq` and `relation`. Comparison filters accept
  a single value only and return `400` otherwise.
- Filters compose with everything else: `?filter[author]=7&filter[search]=lucid&sort=-createdAt&page[size]=10`.
- The declaration doubles as documentation. The resource class _is_ the list of what your
  API's query surface supports.

---

Next: [Writing data](./writing-data.md) · [Links](./links.md) ·
[Errors & negotiation](./errors.md) · [Reference](./reference.md)
