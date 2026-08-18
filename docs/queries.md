# Queries

Reading is one method, `jsonApi.query(Model)`. It returns a normal Lucid query builder with the request's parameters already applied. This page follows the five parameters through it.

## One entry point

`jsonApi.query(Model)` does four things and then hands you the builder:

```ts
query(model) {
  validateIncludeTree(model, params.include) // ?include=
  const q = model.query()
  applyIncludes(q, params.include) // preload the include tree
  applySort(q, params.sort) // ?sort=
  applyFilters(q, params.filter) // ?filter[...]=
  return q
}
```

`params` is the request's query string, already parsed. `jsonApi.params` runs `parseQueryParams` one time and caches the result. It turns the raw `?include=…&sort=…&filter[...]=…` into the object these four functions read. A malformed parameter throws a `400` at that point, before any query runs, so a controller never guards against bad query input. After `query()` returns, `include`, `sort`, and `filter` have narrowed the query, and you chain `.where()`, scopes, and `.paginate()` as usual.

## `include`

Clients ask for related resources with `include`. Paths nest with dots and join with commas:

```
GET /api/v1/articles/1?include=author,comments.author,tags
```

Three things happen:

1. Each path is validated against the model's relations, and against [`exposeRelationships`](./resources.md#one-visibility-rule-four-call-sites). An unsupported path is a `400` with `source: { parameter: "include" }`.
2. The whole tree is preloaded in one pass, so there are no N+1 queries.
3. The results are flattened into `included`, deduplicated by `(type, id)`.

If the same user wrote the article and three of its comments, that user is one entry in `included`. Each resource's `relationships` member carries the `{ type, id }` linkage.

Two details follow from how linkage is built:

- A `belongsTo` gets linkage even with no preload, because the foreign key already holds the id, at no query cost.
- An unloaded to-many is never reported as empty. It appears with `links` and no `data`, because `data: []` would claim it is empty. The client follows the link to load it. See [Concepts](./concepts.md#a-pointer-not-a-nested-copy).

All Lucid relation kinds serialize: `belongsTo` and `hasOne` as to-one, and `hasMany`, `manyToMany`, and `hasManyThrough` as to-many.

## Sparse fieldsets

`fields[<type>]` lists the members to keep for that type. Per the spec, it filters attributes and relationships together:

```
GET /api/v1/articles/1?include=author&fields[articles]=title,author&fields[users]=fullName
```

That returns articles with only a `title` attribute and an `author` relationship, and included users with only `fullName`. The names are serialized names, the same names that appear in documents.

## Sorting

```
GET /api/v1/articles?sort=-createdAt,title
```

`sort` takes comma-separated attribute names. A `-` prefix means descending. Each name is a serialized attribute name, mapped back to its database column. An unknown name is a `400`.

## Pagination

`page[number]` and `page[size]` drive Lucid's paginator through the `jsonApi.page` tuple:

```ts
const articles = await jsonApi.query(Article).paginate(...jsonApi.page)
return jsonApi.render(articles)
```

When the client omits `page[size]`, the size is `defaultPageSize` from `config/jsonapi.ts` (20 by default). A paginated response carries `first`, `prev`, `next`, and `last` links, each keeping the other query parameters of the request. It also carries the current state under `meta`:

```json
"meta": {
  "page": { "number": 2, "size": 10, "total": 47, "lastPage": 5 }
}
```

A single, non-paginated response carries a top-level `links.self` instead, equal to the request URL.

## Filtering

The spec reserves `filter[...]` but leaves its meaning to the server. This package is strict: nothing is filterable unless the resource declares it. A resource with no `filters` rejects every filter, so a client can never probe an arbitrary column. Declare the parameters on the resource class:

```ts
import { JsonApiResource, filter } from '@evoactivity/jsonapi-adonis'

export default class ArticleResource extends JsonApiResource<Article> {
  static type = 'articles'
  static model = () => Article

  static filters = {
    // ?filter[title]=Hello       → where('title', 'Hello')
    // ?filter[title]=a,b         → whereIn('title', ['a', 'b'])
    title: filter.eq(),

    // Map a public name to a column and operator. gt/gte/lt/lte exist.
    // ?filter[publishedAfter]=2026-01-01 → where('created_at', '>=', …)
    publishedAfter: filter.gte('createdAt'),

    // ?filter[author]=7 → where('author_id', 7), by a belongsTo relation
    author: filter.relation('author'),

    // Full control: the Lucid query builder and the raw value.
    search: filter.custom((query, value) => {
      query.where((q) => q.whereILike('title', `%${value}%`).orWhereILike('body', `%${value}%`))
    }),
  }
}
```

The rules follow from the code:

- An undeclared filter name is a `400` with `source: { parameter: "filter[name]" }`, the same strict-input policy as `include` and `sort`.
- `eq` and the comparison filters take serialized attribute names, mapped to columns for you. They default to the filter's own key, so a bare `filter.eq()` needs no argument.
- `eq` and `relation` turn comma-separated values into `whereIn`. A comparison filter (`gt`/`gte`/`lt`/`lte`) takes a single value, and returns `400` for more.
- `filter.relation(name)` needs a belongsTo relation. A wrong name is a programmer error, thrown when the filter runs, not a client `400`.
- A `filter.custom` handler also receives `{ Model, name, ctx }`. `ctx` is the request when filtering runs inside one, so a filter can depend on the viewer. It is `undefined` outside a request.
- Filters compose: `?filter[author]=7&filter[search]=lucid&sort=-createdAt&page[size]=10`.

The declaration is also the documentation. The resource class is the full list of your API's query surface.

## Unknown parameters

The spec reserves simple lowercase parameter names for itself. So an unrecognized all-lowercase parameter (`?foo=bar`) is a `400`. Your own parameters must contain a non-lowercase character (`?cacheBust=1`, `?api_key=…`), and the package ignores them. See [Errors and negotiation](./errors.md#strict-query-parameters).

---

Next: [Scopes](./scopes.md) · [Writes](./writes.md) · [Links](./links.md) · [Reference](./reference.md)
