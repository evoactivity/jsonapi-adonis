# Links

Why JSON:API documents carry links, what the relationship links buy you, and how this package generates them.

## Why links at all

Every resource in a response carries a `self` link, and every relationship carries `self` and `related` links. That means a client never has to construct URLs from conventions it hopes the server follows. It reads them out of the document:

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

The server stays in charge of its own URL space. You can restructure routes, add a version prefix, or mount the same API twice, and clients that follow links keep working.

Links also make lazy loading natural. When a to-many relationship wasn't loaded, this package emits the relationship with links only, no `data`. The client sees that the relationship exists, and has a URL to fetch it when it actually needs it, instead of the server guessing what to preload for everyone.

## Why relationship links matter: concurrent edits

The `related` link fetches the resources on the other side. The `self` link is more interesting: it points at the _relationship itself_, and PATCH/POST/DELETE on it edit the linkage without touching either resource. That distinction sounds academic until two users edit the same relationship at the same time.

Say an article has tags `a, b, c, d, e`. Alice wants to remove `c` and `e`. Bob wants to remove `a` and `b`. Both are looking at the same starting list.

If they each update the parent resource (or send a full-replacement PATCH of the relationship), they send snapshots computed from what they saw:

1. Alice sends `data: [a, b, d]`. The server stores it.
2. Bob sends `data: [c, d, e]`, computed from the stale original.
3. Final state: `c, d, e`. Bob has resurrected the two tags Alice just deleted, and his own deletions wiped out hers. Last write wins, and both of them lose.

If they instead send deltas to the relationship URL:

1. Alice: `DELETE /articles/1/relationships/tags` with `data: [c, e]`
2. Bob: `DELETE /articles/1/relationships/tags` with `data: [a, b]`
3. Final state: `d`, in either order. Both intents survive because remove-these-members and add-these-members are operations, not snapshots, and they compose.

This is why the spec defines POST (add) and DELETE (remove) on to-many relationship URLs, and why it explicitly permits servers to refuse full replacement. It's also why this package returns `403` for hasMany full replacement: an endpoint that invites lost updates is worse than one that asks clients to say what they actually mean.

The same logic applies to your own clients. If a UI lets someone add or remove items from a list, wiring it to POST/DELETE on the relationship link is both simpler and safer than diffing state and PATCHing the parent.

## How links are generated

Resource and relationship URLs come from named routes, not string templates. `router.jsonApiResource('articles', ...)` names its routes `articles.show`, `articles.relationships.show`, `articles.related` and so on, prefixed by the surrounding groups' `.as()` names.

When rendering, the package looks at the route that served the current request, recovers its namespace, and generates links inside that same namespace. This buys you two things:

- API versioning just works. Mount the same resources under `/api/v1` and `/api/v2` groups and the v2 responses link to `/api/v2/...`, including the `Location` header on creation.
- No broken links. A link is only emitted when the named route actually exists. Models that are serialize-only, with no routes registered, get no `self` link instead of a link that 404s.

Don't want links at all? Set `links: false` in `config/jsonapi.ts`.

## Casing

URL path segments are kebab-cased: a `receivedComments` relation lives at `/users/1/relationships/received-comments`, and the endpoints accept the kebab form transparently. Member names inside documents (attributes, relationship keys) stay camelCase, matching the official JSON:API recommendation. Auto-derived resource types are kebab-cased too, turning an `access_tokens` table into the `access-tokens` type.

---

Next: [Errors & negotiation](./errors.md) · [Reference](./reference.md)
