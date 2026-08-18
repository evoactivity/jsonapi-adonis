# Scopes

Filters are client input. Visibility is not. Some rows a client must never see, whatever it asks for: a draft, another user's private data, a soft-deleted row. You express that with Lucid scopes, applied at read time, at the call site. Keeping it at the call site is deliberate. Visibility is a security decision, and a per-endpoint decision stays visible in the code instead of hiding in a resource default that a new endpoint inherits or forgets by accident.

## Two levels, two methods

`jsonApi.query(Model)` gives back a Lucid builder, and a query has two parts to constrain:

- **The root query** — the articles themselves. Constrain it with Lucid's own `withScopes()`. Nothing in this package is involved.
- **The include preloads** — the comments, authors, and tags pulled in by `?include=`. This package builds those preloads for you from the request, so you cannot reach them at the call site. `withPreloadScopes()` is how you constrain them.

```ts
const articles = await jsonApi
  .query(Article)
  .withScopes((scopes) => scopes.published()) // the articles
  .withPreloadScopes({
    comments: (scopes) => scopes.published(), // ?include=comments
    author: (scopes) => scopes.active(), // ?include=author
  })
  .paginate(...jsonApi.page)

return jsonApi.render(articles)
```

Define each rule once, on the model, as an ordinary Lucid scope:

```ts
class Comment extends BaseModel {
  static published = scope((query) => query.where('published', true))
}
```

## How `withPreloadScopes` reaches the preloads

`jsonApi.query()` builds the include preloads from `?include=`, and it attaches an empty scope tree to the query at the same time. `withPreloadScopes()` merges your scopes into that tree. When Lucid runs the preload for a relation, this package reads the tree and applies the matching scope to the preload's own query.

Two properties come out of that timing:

- **Order does not matter.** The tree is read at execution, not when you call the method, so `withPreloadScopes()` can sit before or after other builder calls.
- **It is fully typed.** The map keys autocomplete to the model's relations. Each callback's `scopes` is the related model's set of scopes, exactly like `withScopes()`. A wrong relation name, or a scope that model does not define, is a compile error.

## Nested includes

A nested include takes an object with a `preload` of its own, typed to the next model down:

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

An entry is either a bare callback (scope that relation) or `{ scope?, preload? }` (also constrain deeper includes). A scope applies only along the path you write, so a relation on one branch never leaks to a same-named relation on another branch. A relation with no entry stays unconstrained.

When several endpoints share a rule, move the map into a shared helper. Do not hide it in a default.

---

Next: [Writes](./writes.md) · [Polymorphism](./polymorphism.md) · [Links](./links.md) · [Reference](./reference.md)
