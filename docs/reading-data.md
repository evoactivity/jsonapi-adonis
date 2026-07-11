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

Create a resource class when you want control over any of that:

```ts
// app/resources/user_resource.ts
import User from '#models/user'
import { JsonApiResource } from 'jsonapi-adonis'

export default class UserResource extends JsonApiResource<User> {
  static type = 'users'
  static model = () => User

  /** Choose exactly which attributes are exposed */
  attributes() {
    return {
      ...this.pick(['fullName', 'email']),
      initials: this.resource.initials, // computed values welcome
    }
  }
}
```

Inside a resource class, `this.resource` is the Lucid model instance being serialized (typed
by the generic). `this.ctx` is the current HttpContext when serialization happens inside a
request.

Register it in `config/jsonapi.ts`:

```ts
export default defineConfig({
  resources: [() => import('#resources/user_resource')],
})
```

You can also override `id()`, `links()` and `meta()`, and restrict which relations are
exposed with `static exposeRelationships = ['author', 'tags']`.

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
