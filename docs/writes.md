# Writes

Creating, updating, and deleting rows from JSON:API request documents, plus the relationship endpoints.

## Deserializing a request

A write request wraps the record in a resource document:

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

`jsonApi.deserialize(Model)` turns that into shapes Lucid can use. It returns `{ id?, type, attributes, toMany, references }`:

- **attributes** uses model property names, mapped back from serialized names. An unknown attribute is dropped, so your validator stays the only gate on input. A to-one relationship becomes a foreign key here, so `author` arrives as `authorId`.
- **toMany** is a map of relation name to id list, for after the save.
- **references** is every related id the body named, which `deserialize` checks for existence before it returns. A missing id is a `404`.

```ts
async store({ jsonApi }: HttpContext) {
  const input = await jsonApi.deserialize(Article)
  // input.attributes === { title: 'Hello', body: '...', authorId: '7' }
  const payload = await createArticleValidator.validate(input.attributes)
  const article = await Article.create(payload)
  // input.toMany === { tags: ['1'] }
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

`syncToMany` applies the to-many relationships after the save. A `manyToMany` relation is synced. A `hasMany` relation adopts the listed children by reassigning their foreign key.

## The write error rules

`deserialize` enforces the spec's error rules before your controller runs:

| Situation                                                             | Response      |
| --------------------------------------------------------------------- | ------------- |
| Missing `data`, a non-string `type`, or a malformed identifier        | `400`         |
| `data.type` is not accepted by this endpoint                          | `409`         |
| `data.id` missing on update, or does not match the URL (`expectedId`) | `400` / `409` |
| Client sends an `id` on create, and `allowClientIds` is off           | `403`         |
| A referenced related resource does not exist                          | `404`         |

A relation hidden by [`exposeRelationships`](./resources.md#one-visibility-rule-four-call-sites) is unknown here too. A `relationships` member that names one gets the same `400` as an unknown member, so hiding a relation also closes the write-body path.

## Relationship endpoints

The spec defines URLs for editing a relationship on its own, without touching the resources on either end. `jsonApiResource` registers them when you give it a `relationships` controller:

| Route                                   | Meaning                                |
| --------------------------------------- | -------------------------------------- |
| `GET /articles/1/relationships/tags`    | Read the linkage (`[{ type, id }, …]`) |
| `PATCH /articles/1/relationships/tags`  | Replace all members                    |
| `POST /articles/1/relationships/tags`   | Add members, never duplicating         |
| `DELETE /articles/1/relationships/tags` | Remove the named members               |
| `GET /articles/1/tags`                  | The related resources themselves       |

Each action is one line, delegating to the helper:

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

### What each relation kind accepts on write

Reads work for every kind. Writes branch on the relation kind, and the branches come straight from the code:

| Relation kind    | `PATCH` (replace) | `POST` (add) | `DELETE` (remove) |
| ---------------- | ----------------- | ------------ | ----------------- |
| `belongsTo`      | yes               | `405`        | `405`             |
| `manyToMany`     | yes               | yes          | yes               |
| `hasMany`        | `403`             | yes          | `403`             |
| `hasOne`         | `403`             | `403`        | `403`             |
| `hasManyThrough` | `403`             | `403`        | `403`             |

A `hasMany` refuses full replacement and removal on purpose. The spec lets a server refuse them, and the normal way to move a child is through the child's own belongsTo. A `hasManyThrough` is derived, so it is read-only. See [Links](./links.md#relationship-links-and-concurrent-edits) for why deltas beat full replacement.

All five routes obey [`exposeRelationships`](./resources.md#one-visibility-rule-four-call-sites). A relation the resource hides returns `404` here too, so registering this controller cannot re-open it. Register a subset of the routes with the `relationshipsOnly` option. See [Selecting routes](./reference.md#selecting-routes).

---

Next: [Polymorphism](./polymorphism.md) · [Links](./links.md) · [Errors and negotiation](./errors.md) · [Reference](./reference.md)
