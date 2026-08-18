# JSON:API concepts

[JSON:API](https://jsonapi.org) is a specification for JSON APIs. It fixes the wire format in advance, so a server and a client written by different people agree on the shape of every response without a private contract. This package implements the server half for AdonisJS. This page explains the format it produces. The other guides explain how it produces it.

## The document

Every response is one document. This package models the document as a single TypeScript type, and the whole shape is small:

```ts
type Document = {
  data?: ResourceObject | ResourceObject[] | null
  errors?: ErrorObject[]
  included?: ResourceObject[]
  links?: Links
  meta?: Meta
  jsonapi?: { version: string }
}
```

A success response carries `data`. An error response carries `errors` instead. The two never appear together. `included` holds the related records the client asked for. `links` and `meta` carry URLs and side information.

## A resource

`data` holds resource objects. A resource object is one record:

```ts
type ResourceObject = {
  type: string
  id: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, RelationshipObject>
  links?: Links
  meta?: Meta
}
```

Two fields identify it: a `type` and a string `id`. The spec requires the id to be a string, even for a numeric primary key. The record's own fields go under `attributes`. Its connections to other records go under `relationships`.

## A pointer, not a nested copy

A relationship does not hold the related record. It holds a pointer to it:

```ts
type ResourceIdentifier = { type: string; id: string }

type RelationshipObject = {
  data?: ResourceIdentifier | ResourceIdentifier[] | null
  links?: Links
}
```

So the author of an article is `{ "type": "users", "id": "7" }`, not a copy of the user. The user's fields arrive one time, in the top-level `included` array. A pointer instead of a nested copy is the core choice in the format, and it does three things.

**One copy.** If Alice wrote an article and ten of its comments, she is one entry in `included`, and eleven pointers name `users:7`. A nested format would send her eleven times.

**One identity.** `type` plus `id` is an address. A client cache stores each record one time under that address, so a later edit to Alice updates every view that points at her. A nested copy has no address, so the client cannot tell which copies to change.

**Two kinds of empty.** `data: []` means the relationship is empty. A relationship with links and no `data` means not loaded. A nested `[]` cannot tell those apart.

## Reading a document

Read raw, a pointer puts a field two hops away:

```js
const article = response.data.data
const authorId = article.relationships.author.data.id
const author = response.data.included.find((r) => r.type === 'users' && r.id === authorId)
author.attributes.fullName
```

You do not write that. The shape is identical on every JSON:API server, so one library rejoins the pointers to their records:

```js
import { Jsona } from 'jsona'

const article = new Jsona().deserialize(response.data)
article.author.fullName // relationship resolved from included
```

Existing clients already do this: `jsona`, `Kitsu`, `jsonapi-react`, the typed definitions in `jsonapi-typescript`, and native clients for Swift and Kotlin. They also do pagination, includes, and sparse fieldsets, because those behave identically on every compliant server.

## Where this package fits

`@evoactivity/jsonapi-adonis` builds these documents from your Lucid models. It reads the query parameters, writes rows from request documents, serves the relationship endpoints, and renders errors as error documents. Your models are the source of the data. The rest of these guides cover each part.

---

Next: [Getting started](./getting-started.md) · [Resources](./resources.md) · [Queries](./queries.md) · [Reference](./reference.md)
