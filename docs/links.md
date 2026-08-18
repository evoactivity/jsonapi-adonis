# Links

This page explains why JSON:API documents carry links, what the relationship links give you, and how this package generates them.

## Why links at all

Every resource in a response carries a `self` link, and every relationship carries `self` and `related` links. So a client never has to build URLs from conventions it hopes the server follows. It reads them from the document:

```json
{
  "type": "articles",
  "id": "1",
  "relationships": {
    "tags": {
      "links": {
        "self": "/api/v1/articles/1/relationships/tags",
        "related": "/api/v1/articles/1/tags"
      }
    }
  },
  "links": { "self": "/api/v1/articles/1" }
}
```

The server controls its own URL space. You can restructure routes, add a version prefix, or mount the same API twice, and clients that follow links keep working.

Links also make lazy loading natural. When a to-many relationship was not loaded, this package emits the relationship with links only, no `data`. The client sees that the relationship exists. It has a URL to fetch the relationship when it needs it, so the server does not guess what to preload for everyone.

## Relationship links and concurrent edits

The `related` link fetches the resources on the other side. The `self` link is different. It points at the _relationship itself_, and PATCH, POST, or DELETE on it edit the linkage without touching either resource. That difference seems abstract until two users edit the same relationship at the same time.

Suppose an article has tags `a, b, c, d, e`. Alice wants to remove `c` and `e`. Bob wants to remove `a` and `b`. Both are looking at the same starting list.

If they each update the parent resource (or send a full-replacement PATCH of the relationship), they send snapshots computed from what they saw:

1. Alice sends `data: [a, b, d]`. The server stores it.
2. Bob sends `data: [c, d, e]`, computed from the stale original.
3. Final state: `c, d, e`. Bob has restored the two tags Alice just deleted, and his own deletions removed hers. Last write wins, and both of them lose.

If they instead send deltas to the relationship URL:

1. Alice: `DELETE /articles/1/relationships/tags` with `data: [c, e]`
2. Bob: `DELETE /articles/1/relationships/tags` with `data: [a, b]`
3. Final state: `d`, in either order. Both intents survive because remove-these-members and add-these-members are operations, not snapshots, and they compose.

This is why the spec defines POST (add) and DELETE (remove) on to-many relationship URLs, and why it explicitly lets servers refuse full replacement. It is also why this package returns `403` for hasMany full replacement. An endpoint that causes lost updates is worse than one that asks clients to say what they mean.

The same logic applies to your own clients. If a UI lets someone add or remove items from a list, connect it to POST or DELETE on the relationship link. That is simpler and safer than computing a diff and PATCHing the parent.

## How links are generated

Resource and relationship URLs come from named routes, not string templates. `router.jsonApiResource('articles', ...)` names its routes `articles.show`, `articles.relationships.show`, `articles.related` and so on, prefixed by the surrounding groups' `.as()` names.

When rendering, the package looks at the route that served the current request, recovers its namespace, and generates links inside that same namespace. This gives you two things:

- API versioning works with no extra setup. Mount the same resources under `/api/v1` and `/api/v2` groups, and the v2 responses link to `/api/v2/...`, including the `Location` header on creation.
- No broken links. A link is emitted only when the named route exists. Models that are serialize-only, with no routes registered, get no `self` link instead of a link that 404s.

To turn off links, set `links: false` in `config/jsonapi.ts`.

## Casing

URL path segments are kebab-cased. A `receivedComments` relation is at `/users/1/relationships/received-comments`, and the endpoints accept the kebab form. Member names inside documents (attributes, relationship keys) stay camelCase, which matches the official JSON:API recommendation. Auto-derived resource types are kebab-cased too, so an `access_tokens` table becomes the `access-tokens` type.

---

Next: [Errors & negotiation](./errors.md) · [Reference](./reference.md)
