# Links

A JSON:API document carries the URLs a client needs, so the client reads them instead of building them from a convention it hopes the server keeps:

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

The server owns its URL space. You can restructure routes, add a version prefix, or mount the same API twice, and a client that follows links keeps working.

## Links come from named routes

The package never builds a URL from a string template. It builds every URL from a named route registered by `router.jsonApiResource()`. That helper names its routes by convention:

```
articles.show
articles.relationships.show
articles.related
```

Two consequences follow from generating URLs this way.

**A link that would 404 is not emitted.** Before it writes a link, the builder asks the router whether the named route exists. If it does not, the member has no link. So a model that is serialize-only, with no routes registered, gets no `self` link, instead of a link that leads nowhere.

**Versioning is automatic.** The builder reads the name of the route that served the current request, takes its namespace (`api.v1`), and generates every link inside that same namespace. Mount the same resources under an `api.v1` group and an `api.v2` group, and a request to v2 produces v2 links, including the `Location` header on a `201`. Nothing in the controller changes.

To turn links off, set `links: false` in `config/jsonapi.ts`.

## Relationship links and concurrent edits

Every relationship carries two links. `related` fetches the resources on the other side. `self` points at the relationship itself, and `PATCH`, `POST`, or `DELETE` on it edit the linkage without touching either resource. That distinction matters the moment two people edit one relationship at once.

An article has tags `a, b, c, d, e`. Alice wants to remove `c` and `e`. Bob wants to remove `a` and `b`. Both start from the same list.

If each one sends a full-replacement `PATCH`, they send snapshots computed from what they saw:

1. Alice sends `[a, b, d]`. The server stores it.
2. Bob sends `[c, d, e]`, computed from the stale original.
3. Final state: `c, d, e`. Bob has restored the two tags Alice removed, and his own removals erased hers. Last write wins, and both lose.

If each one sends a delta to the relationship URL:

1. Alice: `DELETE …/relationships/tags` with `[c, e]`.
2. Bob: `DELETE …/relationships/tags` with `[a, b]`.
3. Final state: `d`. Both intents survive, because remove-these and add-these are operations, not snapshots, so they compose.

This is why the spec puts `POST` (add) and `DELETE` (remove) on to-many relationship URLs, and why it lets a server refuse full replacement. It is also why this package answers hasMany full replacement with `403`. See [Writes](./writes.md#what-each-relation-kind-accepts-on-write). The same reasoning applies to your own UI: wire an add/remove control to `POST`/`DELETE` on the relationship link, not to a diff-and-PATCH of the parent.

## Casing

A URL path segment is kebab-cased. A `receivedComments` relation is at `/users/1/relationships/received-comments`, and the endpoints accept the kebab form. Member names inside documents (attributes, relationship keys) stay camelCase, which matches the JSON:API recommendation. An auto-derived type is kebab-cased too, so an `access_tokens` table becomes the `access-tokens` type.

---

Next: [Errors and negotiation](./errors.md) · [Building blocks](./low-level.md) · [Reference](./reference.md)
