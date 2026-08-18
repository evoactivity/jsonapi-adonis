# Reading data

This page explains how models become resources. It also explains how the read-side query parameters (`include`, `fields`, `sort`, `page`, `filter`) behave.

## Resources and types

Every Lucid model can serialize as a JSON:API resource with no configuration. The defaults come from the model's own metadata:

- **type** is the kebab-cased table name (`users`, `articles`, `access-tokens`)
- **id** is the primary key, converted to a string (the spec requires string ids)
- **attributes** are the serializable columns. This set excludes the primary key and any belongsTo foreign keys, which become relationships instead. `serializeAs` applies, and columns marked `serializeAs: null`, like password hashes, never appear.
- **relationships** are the relations defined on the model

## Customizing a resource

Write a resource class when you want control over any of the defaults. Register it in `config/jsonapi.ts`:

```ts
// app/resources/user_resource.ts
import User from '#models/user'
import { JsonApiResource } from '@evoactivity/jsonapi-adonis'

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

The class above is already valid. `static model` is the only required member. Registering without it throws, and everything else uses the auto-derived behavior. Inside any instance method, `this.resource` is the Lucid model instance to serialize, typed by the generic. `this.ctx` is the current HttpContext when serialization runs inside a request, and `undefined` outside one.

Why is `static model` required when serialization does not need a resource class? The registry is a map from model class to resource class. Serialization starts from a Lucid row, so the model is always the known side, and auto-derivation is what happens on a map miss. Registering a class means storing it under a key, and `static model` is that key. Without the key the class is unreachable, so the registry throws an error instead of ignoring a resource you wrote.

Every claim in this section has a test in [`tests/unit/resource_customization.spec.ts`](../tests/unit/resource_customization.spec.ts). If the docs and the code disagree, that suite fails.

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

Overrides the resource type everywhere the model appears. This includes primary data, linkage pointers, `included`, and the type clients must send in write requests.

```ts
export default class UserResource extends JsonApiResource<User> {
  static model = () => User
  static type = 'people'
}
```

### `id()`

The default returns the primary key as a string. Override it to show a different public identity, for example a slug or a prefixed id. The override applies everywhere. `data.id`, relationship linkage, and `included` all agree, because deduplication and pointers go through the same method.

```ts
id() {
  return `u-${this.resource.id}`
}
```

The id is identity, not decoration. If you override it on a resource that has write endpoints, clients send this id back, and your controllers must be able to find records by it.

### `attributes()`

The default returns every serializable column except three: the primary key (already in `id`), belongsTo foreign keys (already in `relationships`), and anything marked `serializeAs: null`. Override it to choose the set. `this.pick([...])` selects columns by their serialized names, and computed values are plain properties:

```ts
attributes() {
  return {
    ...this.pick(['fullName', 'email']),
    initials: this.resource.initials,
  }
}
```

Sparse fieldsets (`?fields[type]=`) filter whatever this method returns, so computed attributes work like any other.

### `links()`

Whatever you return is merged over the generated links. You can add links or replace the generated `self`:

```ts
links() {
  return { canonical: `https://example.com/u/${this.resource.id}` }
}
```

The generated `self` stays next to your additions. If you return a `self` key, it replaces the generated one.

### `meta()`

Attach per-resource metadata. If you return `undefined` or an empty object, the `meta` member is omitted, so you can make it conditional:

```ts
meta() {
  return { isOwn: this.ctx?.auth?.user?.id === this.resource.id }
}
```

### `static exposeRelationships`

By default every relation on the model appears as a relationship member. List the ones you want to show, and the rest disappear from documents:

```ts
static exposeRelationships = ['author', 'tags']
```

Hidden relations are also hidden from `?include=`. A request to include one is rejected with a `400`, exactly like an include path that does not exist, and no preload happens for it. A hidden relation is never loaded only to be dropped at serialization.

A hidden relation is also unreachable through the relationship endpoints, for both reads and writes:

```
GET    /articles/1/comments                 404
GET    /articles/1/relationships/comments   404
PATCH  /articles/1/relationships/comments   404
POST   /articles/1/relationships/comments   404
DELETE /articles/1/relationships/comments   404
```

The status is `404`, not `403`, so a hidden relation looks the same as one that was never defined. A `403` shows the relation exists, which is the thing you were hiding.

The same applies to the `relationships` member of a `POST` or `PATCH` body. A hidden relation there is rejected with the same `400` an unknown member gets. Hiding a relation removes it from the whole API. That means documents, `?include=`, the relationship endpoints, and write bodies.

### `static filters`

Declares the `?filter[...]` parameters this resource accepts. Nothing is filterable without it. [Filtering](#filtering) below covers it in depth.

## Relationships and included data

Clients ask for related resources with the `include` parameter. Paths can be nested with dots and combined with commas:

```
GET /api/v1/articles/1?include=author,comments.author,tags
```

The package does three things. It validates every path against the model's relations. Unsupported paths are a `400` with `source: { parameter: "include" }`, per spec. It preloads the whole tree in one pass to avoid N+1 queries. It flattens the results into `included`, deduplicated by `(type, id)`. If the same user wrote the article and three of its comments, they appear one time. Each resource's `relationships` member carries the `{ type, id }` linkage.

Two behaviors need a mention:

- A `belongsTo` relationship gets linkage even without a preload. The foreign key already holds the answer, at no query cost.
- An unloaded to-many relationship is never reported as empty. It appears with `links` only, because `data: []` is not true. The spec separates "empty" from "not loaded", and the client can follow the link to find out.

All Lucid relation kinds serialize: `belongsTo` and `hasOne` as to-one, `hasMany`, `manyToMany` and `hasManyThrough` as to-many.

## Sparse fieldsets

Clients can trim responses per resource type. `fields[<type>]` lists the fields to keep, and per the spec it applies to attributes _and_ relationships:

```
GET /api/v1/articles/1?include=author&fields[articles]=title,author&fields[users]=fullName
```

Returns articles with only a `title` attribute and `author` relationship, and included users with only `fullName`.

## Sorting and pagination

```
GET /api/v1/articles?sort=-createdAt,title&page[number]=2&page[size]=10
```

- `sort` accepts comma-separated attribute names. A `-` prefix means descending. Names are matched against serialized attribute names and mapped to the underlying columns. Unknown fields are a `400`.
- `page[number]` and `page[size]` map to Lucid's paginator via `jsonApi.page`. Paginated responses carry `first`, `prev`, `next`, and `last` links and a `meta.page` object with totals. The links keep your other query parameters, per spec.

## Filtering

The spec reserves `filter[...]` but leaves its meaning to the server. This package is strict and declarative. Nothing is filterable unless the resource says so. Declare filters on the resource class:

```ts
import { JsonApiResource, filter } from '@evoactivity/jsonapi-adonis'

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

    // Handlers also receive { Model, name, ctx }. ctx is the request
    // when filtering runs inside one, so a filter can depend on the
    // viewer; it is undefined on the low-level path outside a request.
    mine: filter.custom((query, _value, { ctx }) => {
      query.where('author_id', ctx!.auth.user!.id)
    }),
  }
}
```

The rules:

- An undeclared filter name is a `400` with `source: { parameter: "filter[name]" }`. This is the same strict-input policy as `include` and `sort`. A resource with no `filters` rejects all filtering, and clients can never probe arbitrary columns.
- Attribute names in `filter.eq()` and the comparison filters are serialized names, mapped to database columns for you. They default to the filter's own key, so the bare `filter.eq()` needs no argument.
- Comma-separated values become `whereIn` for `eq` and `relation`. Comparison filters accept a single value only and return `400` otherwise.
- Filters compose with everything else: `?filter[author]=7&filter[search]=lucid&sort=-createdAt&page[size]=10`.
- The declaration is also documentation. The resource class is the full list of your API's query surface.

## Scopes on reads

Filters are client input. Visibility is not. Some rows a client must never see, whatever it asks for. Express that with Lucid model scopes, applied at read time, at the call site. It then stays a deliberate decision on every endpoint, not hidden behavior.

Define the rule one time, on the model, as a Lucid scope:

```ts
import { BaseModel, scope } from '@adonisjs/lucid/orm'

class Comment extends BaseModel {
  static published = scope((query) => query.where('published', true))
}
```

Apply it to the primary data with Lucid's own `withScopes()`, and to included relations with `withPreloadScopes()`, keyed by the model's relations:

```ts
const articles = await jsonApi
  .query(Article)
  .withScopes((scopes) => scopes.published()) // the articles themselves
  .withPreloadScopes({
    comments: (scopes) => scopes.published(), // ?include=comments
    author: (scopes) => scopes.active(), // ?include=author
  })
  .paginate(...jsonApi.page)

return jsonApi.render(articles)
```

The map is **fully typed**. Keys autocomplete to `Article`'s relations, and each callback's `scopes` is the related model's set of scopes, exactly like `withScopes()`. A wrong relation name, or a scope that model does not define, is a compile error.

For nested includes, give the value an object with a `preload` of its own, typed to the next model:

```ts
.withPreloadScopes({
  seasons: {
    scope: (scopes) => scopes.visible(), // scopes: Season's
    preload: {
      episodes: (scopes) => scopes.visible(), // scopes: Episode's
    },
  },
})
```

- `withScopes()` is Lucid's own. It constrains the root query, with nothing library-specific.
- `withPreloadScopes()` is what this package adds. The include preloads are built for you from `?include=`, so you cannot reach them at the call site. This method constrains them. Each callback is the exact shape of a `withScopes()` callback, so you reuse the related model's own named scopes instead of writing the rule again.
- **Structural, typed at every level.** An entry is either a bare callback (scope that relation) or `{ scope?, preload? }` to also constrain deeper includes. Scopes apply along the path you write, so a relation on one branch never applies to a same-named relation on another. A relation with no entry stays unconstrained.
- **Order in the chain does not matter.** Preload constraints run when Lucid loads the relation, at execution, so `withPreloadScopes()` can come before or after other builder calls.

This is deliberately explicit and per-query. Visibility is a security concern. A per-endpoint decision keeps it visible in the code. It is not a resource default that a new endpoint inherits by accident or forgets by accident. When several endpoints share a rule, move the map into a shared helper. Do not hide it.

---

Next: [Writing data](./writing-data.md) · [Polymorphism](./polymorphism.md) · [Links](./links.md) · [Errors & negotiation](./errors.md) · [Reference](./reference.md)
