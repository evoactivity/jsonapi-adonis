<img src="./header.svg" alt="@evoactivity/jsonapi-adonis" width="100%">

# Adonis JSON:API

Serve a spec-compliant JSON:API from your Lucid models. Every model serializes with no configuration, and each endpoint is a few lines. The package builds compound documents, includes, sparse fieldsets, sorting, filtering, pagination, error documents, content negotiation, and full write support.

```ts
// A complete JSON:API endpoint:
async index({ jsonApi }: HttpContext) {
  const articles = await jsonApi.query(Article).paginate(...jsonApi.page)
  return jsonApi.render(articles)
}
```

New to the format? Start with [JSON:API concepts](./docs/concepts.md).

## Installation

```sh
node ace add @evoactivity/jsonapi-adonis
```

This installs the package and configures it. It writes `config/jsonapi.ts`, registers the provider and the `jsonApi` named middleware, and registers the generator commands.

**Requirements.** AdonisJS v7 (`@adonisjs/core` ^7) and Lucid v22 (`@adonisjs/lucid` ^22).

## A complete controller

`jsonApi.query(Model)` is `Model.query()` with the request's `include`, `sort`, and `filter` already applied, so you chain `.where()`, scopes, and `.paginate()` as usual. `jsonApi.render(...)` builds the document and sets the media type:

```ts
export default class ArticlesController {
  async index({ jsonApi }: HttpContext) {
    const articles = await jsonApi.query(Article).paginate(...jsonApi.page)
    return jsonApi.render(articles)
  }

  async show({ jsonApi, params }: HttpContext) {
    const article = await jsonApi.query(Article).where('id', params.id).firstOrFail()
    return jsonApi.render(article)
  }

  async store({ jsonApi }: HttpContext) {
    const input = await jsonApi.deserialize(Article)
    const article = await Article.create(await createArticleValidator.validate(input.attributes))
    await jsonApi.syncToMany(article, input.toMany)
    return jsonApi.render(article, { status: 201 })
  }
}
```

A request like `GET /api/v1/articles/1?include=author,tags` returns the article as `data`, the author and tags in `included` with duplicates removed, the linkage, `self` and `related` links, and the `application/vnd.api+json` content type. Unknown include paths get a `400`, and there are no N+1 queries. The [Getting started](./docs/getting-started.md) guide walks through the full setup.

## Documentation

| Guide                                        | Covers                                                      |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Concepts](./docs/concepts.md)               | The format, and where this package fits                     |
| [Getting started](./docs/getting-started.md) | Install, generate, first request, error rendering           |
| [Resources](./docs/resources.md)             | How a model becomes a resource, and how to customize it     |
| [Queries](./docs/queries.md)                 | `include`, sparse fieldsets, sorting, pagination, filtering |
| [Scopes](./docs/scopes.md)                   | Row visibility with `withScopes` and `withPreloadScopes`    |
| [Writes](./docs/writes.md)                   | Create, update, delete, and the relationship endpoints      |
| [Polymorphism](./docs/polymorphism.md)       | Mixed-type relationships with single-table inheritance      |
| [Links](./docs/links.md)                     | Route-driven URLs, API versioning, casing                   |
| [Errors and negotiation](./docs/errors.md)   | Error documents, `handlesErrors()`, media type rules        |
| [Building blocks](./docs/low-level.md)       | Serializing outside a request: commands, jobs, tests        |
| [Reference](./docs/reference.md)             | The `jsonApi` helper API, config, generators, roadmap       |

## The example app

[`examples/blog`](./examples/blog) is a complete AdonisJS application with articles, comments, tags, users, and attachments. It uses every feature, and mounts the same resources under `/api/v1` and `/api/v2` to show versioned links.

```sh
pnpm install
cd examples/blog
node ace migration:run
node ace db:seed
node ace serve --watch

curl 'localhost:3333/api/v1/articles?include=author,tags'
```

## Running the tests

```sh
pnpm test           # package unit tests (no database needed)
pnpm test:example   # example app functional suite (spec compliance, writes, links)
pnpm test:all       # both
```

## License

MIT
