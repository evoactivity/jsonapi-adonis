# What is JSON:API?

[JSON:API](https://jsonapi.org) is a specification for JSON APIs. It defines how resources, relationships, errors, and query parameters look in the response. Servers and clients from different teams, in different languages, work together with no custom code. JSON:API started in 2013. It is stable at version 1.1, and it has mature implementations for servers and clients.

This page answers the common questions.

## What problem does it solve?

Every API team designs the same things:

- how to shape a record
- how to embed related records
- how to paginate
- how to report errors
- what the query parameters for sorting and field selection look like

None of these decisions make your product better. They are pure convention. But every custom API decides them again, documents them, and then writes custom client code for the result.

[JSON:API](https://jsonapi.org) is those decisions, made one time, written down, and versioned. You point at the spec instead of writing your own. The server and the client both reuse existing tools.

## What does a response look like?

This is one article, with its author:

```json
{
  "jsonapi": { "version": "1.1" },
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": { "title": "Hello JSON:API", "body": "..." },
    "relationships": {
      "author": { "data": { "type": "users", "id": "7" } }
    },
    "links": { "self": "/api/v1/articles/1" }
  },
  "included": [{ "type": "users", "id": "7", "attributes": { "fullName": "Alice" } }]
}
```

Every record is a resource with a `type` and a string `id`. Its fields go under `attributes`. Its references to other resources go under `relationships`, as `{ type, id }` pointers. Related records the client asked for arrive in the flat `included` array, each one time.

## Why not nest related records directly?

Nesting is the first choice for most people. `article.author` is an object. `article.comments` is an array of objects, each with its own nested `author`. It looks good in a code sample, but it breaks at scale, for three reasons.

**Duplication.** If Alice wrote the article and ten of its comments, a nested response serializes Alice eleven times. JSON:API sends her one time, in `included`. Everything else points at `users:7`.

**Identity.** A nested object has no address. The client can receive Alice in three different places. When she changes her name, which copies does the client patch? With `{ type, id }` pointers there is one Alice. Client-side caches can normalize records and keep every view consistent at no cost.

**Ambiguity.** In a nested response, what does `"comments": []` mean? It can mean no comments, or comments not loaded. JSON:API separates the two. An empty relationship has `data: []`. An unloaded relationship has links and no `data`. Cycles also stop being a serialization problem, because pointers do not recurse. A cycle is an article whose comments point back at the article.

## Is it verbose to consume?

If you read the documents raw, yes. This is the common form of the complaint:

```js
// a bespoke API
const name = response.data.author.name

// raw JSON:API (response.data is axios, .data.data is the document)
const article = response.data.data
const authorId = article.relationships.author.data.id
const author = response.data.included.find((r) => r.type === 'users' && r.id === authorId)
const name = author.attributes.fullName
```

Nobody wants to write `response.data.data.attributes.title` and search `included` by hand in every component. You do not have to. The shape is identical on every compliant API, so the flattening code is a library, not code you write:

```js
import { Jsona } from 'jsona'

const article = new Jsona().deserialize(response.data)
article.title // attributes are flattened
article.author.fullName // relationships resolved from included
```

One deserializer call turns any document from any JSON:API server back into plain nested objects. The relationships are already joined. The deep paths still exist, but only inside a package you install.

This is the deliberate trade of the format. A custom API gives you short access paths. The cost is parsing code that is different for every endpoint of every API you consume. JSON:API makes the raw paths uniform, so one generic library can remove them everywhere. Short but unique paths lose to long but identical paths once you add tools.

Some people mean the payload itself is verbose. gzip compresses the repeated envelope keys well. For relationship-heavy data, the removed duplicates usually save more. Sending Alice one time instead of eleven times saves more bytes than the `attributes` wrappers cost. Naive nesting is the verbose format. It hides the extra bytes in duplication.

## How do API consumers benefit?

Libraries already support the format. On the web you can use `jsona`, `Kitsu`, or `jsonapi-react`, plus typed document definitions in `jsonapi-typescript`. On mobile there are JSON:API clients for Swift and Kotlin, for example `swift-jsonapi` and `Spraypaint`. All of them do pagination, includes, sparse fieldsets, and error handling correctly. Those behave identically on every compliant API.

## Where does @evoactivity/jsonapi-adonis fit?

It implements the server side of the spec for AdonisJS. Your Lucid models are the one source of the data. It does serialization, includes, sparse fieldsets, sorting, filtering, pagination, writes, relationship endpoints, error documents, and content negotiation. The rest of these docs cover each part.

---

Next: [Reading data](./reading-data.md) · [Writing data](./writing-data.md) · [Links](./links.md) · [Errors & negotiation](./errors.md) · [Reference](./reference.md)
