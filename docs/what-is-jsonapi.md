# What is JSON:API?

[JSON:API](https://jsonapi.org) is a specification for building JSON APIs. It defines how resources, relationships, errors and query parameters look on the wire, so servers and clients written by different teams, in different languages, interoperate without custom glue code. It has been around since 2013, is stable at version 1.1, and has mature implementations on both sides of the wire.

The rest of this page covers the questions that usually come up.

## What problem does it solve?

Every API team ends up designing the same things: how to shape a record, how to embed related records, how to paginate, how to report errors, what the query parameters for sorting and field selection look like. None of those decisions make your product better. They're pure convention, and yet every bespoke API relitigates them, documents them, and then writes custom client code for the result.

[JSON:API](https://jsonapi.org) is those decisions, made once, written down carefully, and versioned. You point at the spec instead of writing your own, and both sides of the wire get to reuse existing tooling.

## What does a response look like?

Here's "one article, with its author":

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

Every record is a resource with a `type` and a string `id`. Its fields live under `attributes`. Its connections to other resources live under `relationships`, as `{ type, id }` pointers. Related records the client asked for arrive in the flat `included` array, each exactly once.

## Why not just nest related records directly?

Nesting is what everyone reaches for first: `article.author` is an object, `article.comments` is an array of objects with their own nested `author`. It reads nicely in a code sample and falls apart at scale, for three reasons.

**Duplication.** If Alice wrote the article and ten of its comments, a nested response serializes Alice eleven times. JSON:API sends her once, in `included`, and everything else points at `users:7`.

**Identity.** A nested object has no address. When the client receives Alice embedded in three different places and she updates her name, which copies does it patch? With `{ type, id }` pointers there is exactly one Alice, so client-side caches can normalize records and keep every view consistent for free.

**Ambiguity.** In a nested response, what does `"comments": []` mean? No comments, or comments not loaded? JSON:API distinguishes them: an empty relationship has `data: []`, an unloaded one has links and no `data`. Cycles (an article whose comments point back at the article) also stop being a serialization problem, because pointers don't recurse.

## Isn't it verbose to consume?

If you read the documents raw, yes. This is the complaint as most people meet it:

```js
// a bespoke API
const name = response.data.author.name

// raw JSON:API (response.data is axios, .data.data is the document)
const article = response.data.data
const authorId = article.relationships.author.data.id
const author = response.data.included.find((r) => r.type === 'users' && r.id === authorId)
const name = author.attributes.fullName
```

Nobody wants to write `response.data.data.attributes.title` and hand-search `included` in every component. The answer is that you don't. Because the shape is identical on every compliant API, the flattening code is a library, not something you write:

```js
import { Jsona } from 'jsona'

const article = new Jsona().deserialize(response.data)
article.title // attributes are flattened
article.author.fullName // relationships resolved from included
```

One deserializer call turns any document from any JSON:API server back into the plain nested objects you wanted, with the relationships already stitched together. The deep paths still exist, but only inside a package you install.

That's the trade the format makes on purpose. A bespoke API gives you terse access paths at the cost of parsing code that is different for every endpoint of every API you consume. JSON:API makes the raw paths uniform and boring, precisely so that one generic library can erase them everywhere. Terse-but-unique loses to verbose-but-identical the moment tooling enters the picture.

And when someone means the payload itself is verbose: the repeated envelope keys are what gzip is best at, and for relationship-heavy data the deduplication usually wins outright. Sending Alice once instead of eleven times saves more bytes than `attributes` wrappers cost. Naive nesting is the verbose format; it hides the verbosity in duplication.

## How do API consumers benefit?

Libraries that already speak the format, on day one. Options like `jsona`, `Kitsu`, `jsonapi-react` plus typed document definitions in `jsonapi-typescript`. On mobile there are JSON:API clients for Swift and Kotlin eg `swift-jsonapi`, `Spraypaint`. All of them get pagination, includes, sparse fieldsets and error handling right, because those behave identically on every compliant API.

## Where does jsonapi-adonis fit?

It implements the server side of the spec for AdonisJS, using your Lucid models as the source of truth: serialization, includes, sparse fieldsets, sorting, filtering, pagination, writes, relationship endpoints, error documents and content negotiation. The rest of these docs cover each piece.

---

Next: [Reading data](./reading-data.md) · [Writing data](./writing-data.md) · [Links](./links.md) · [Errors & negotiation](./errors.md) · [Reference](./reference.md)
