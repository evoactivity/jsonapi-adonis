# Writing data

Creating, updating and deleting resources from JSON:API request documents, and the relationship endpoints.

## Resource writes

JSON:API write requests wrap everything in a resource document:

```json
POST /api/v1/articles
Content-Type: application/vnd.api+json

{
  "data": {
    "type": "articles",
    "attributes": { "title": "Hello", "body": "..." },
    "relationships": {
      "author": { "data": { "type": "users", "id": "7" } },
      "tags": { "data": [{ "type": "tags", "id": "1" }] }
    }
  }
}
```

`jsonApi.deserialize(Model)` unpacks that into Lucid-friendly shapes:

```ts
async store({ jsonApi }: HttpContext) {
  const input = await jsonApi.deserialize(Article)
  // input.attributes === { title: 'Hello', body: '...', authorId: '7' }
  //   to-one relationships become foreign keys, ready for your validator
  const payload = await createArticleValidator.validate(input.attributes)
  const article = await Article.create(payload)
  // input.toMany === { tags: ['1'] }, synced after save
  await jsonApi.syncToMany(article, input.toMany)
  return jsonApi.render(article, { status: 201 }) // sets the Location header
}

async update({ jsonApi, params }: HttpContext) {
  const article = await Article.findOrFail(params.id)
  const input = await jsonApi.deserialize(Article, { expectedId: String(article.id) })
  article.merge(await updateArticleValidator.validate(input.attributes))
  await article.save()
  await jsonApi.syncToMany(article, input.toMany)
  return jsonApi.render(article)
}
```

The deserializer enforces the spec's error semantics for you:

| Situation                                                                   | Response      |
| --------------------------------------------------------------------------- | ------------- |
| Malformed document (missing `data`, bad identifiers, unknown relationship…) | `400`         |
| `data.type` doesn't match the endpoint                                      | `409`         |
| `data.id` missing on update, or doesn't match the URL                       | `400` / `409` |
| Client sends an `id` on creation (unless `allowClientIds: true`)            | `403`         |
| A referenced related resource doesn't exist                                 | `404`         |

Attribute names are mapped back from their serialized names to model property names. Unknown attributes are dropped, and your validator remains the gatekeeper.

## Relationship endpoints

The spec defines URLs for reading and editing a relationship itself, without touching the resources on either end. Editing linkage through these URLs sends deltas rather than snapshots, which protects concurrent editors from overwriting each other; the [links guide](./links.md) walks through a lost-update example. `jsonApiResource` registers the endpoints when you provide a `relationships` controller:

| Route                                   | Meaning                                |
| --------------------------------------- | -------------------------------------- |
| `GET /articles/1/relationships/tags`    | Read the linkage (`[{ type, id }, …]`) |
| `PATCH /articles/1/relationships/tags`  | Replace all members                    |
| `POST /articles/1/relationships/tags`   | Add members (never duplicates)         |
| `DELETE /articles/1/relationships/tags` | Remove the given members               |
| `GET /articles/1/tags`                  | The related resources themselves       |

The controller is thin. Every action delegates to the context helper:

```ts
export default class ArticleRelationshipsController {
  async show({ jsonApi, params }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    return jsonApi.renderRelationship(article, params.relation)
  }
  async replace({ jsonApi, params }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    return jsonApi.updateRelationship(article, params.relation, 'replace')
  }
  // add → 'add', remove → 'remove', related → renderRelated(...)
}
```

To-one relationships accept `PATCH` only (a `405` otherwise). For `hasMany`, full replacement and removal are rejected with `403`. The spec explicitly allows a server to refuse those, and the natural write path for a hasMany is the child's own belongsTo. `manyToMany` supports everything. `hasManyThrough` relationships are derived, and all writes through them are rejected.

---

Next: [Links](./links.md) · [Errors & negotiation](./errors.md) · [Reference](./reference.md)
