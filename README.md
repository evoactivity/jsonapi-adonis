<img src="./header.svg" alt="jsonapi-adonis" width="100%">

# Adonis JSON:API

Serve a spec-compliant API from your existing Lucid models with a few lines per endpoint.
Includes, sparse fieldsets, sorting, filtering, pagination, error documents, content
negotiation and full write support are all handled for you.

```ts
// A complete JSON:API endpoint:
async index({ jsonApi }: HttpContext) {
  const articles = await jsonApi.query(Article).paginate(...jsonApi.page)
  return jsonApi.render(articles)
}
```

New to JSON:API itself? Start with [What is JSON:API?](./docs/what-is-jsonapi.md)

## Installation

```sh
node ace add jsonapi-adonis
```

This installs the package and configures it: it creates `config/jsonapi.ts`, then registers
the provider, the `jsonApi` named middleware and the generator commands.

**Requirements:** AdonisJS v7 (`@adonisjs/core` ^7), Lucid v22 (`@adonisjs/lucid` ^22).

## Quick start

**1. Generate a resource and controllers** for one of your models:

```sh
node ace make:jsonapi:resource article --relationships --routes
```

This creates `app/resources/article_resource.ts` and the controllers, and registers the
routes. You can also write them by hand, see the [reference](./docs/reference.md). Register
the resource in `config/jsonapi.ts`:

```ts
export default defineConfig({
  resources: [() => import('#resources/article_resource')],
})
```

**2. That's it. Make a request:**

```
GET /api/v1/articles/1?include=author,tags
```

You get a complete JSON:API document: the article as primary `data`, the author and tags in
`included` (deduplicated), relationship linkage, `self` and `related` links, and the
`application/vnd.api+json` content type. The `?include=` paths were validated and preloaded
in one pass. Unknown paths get a 400, as the spec requires, and there are no N+1 queries.

The generated controller is plain AdonisJS. `jsonApi.query(Article)` is literally
`Article.query()` with the request's `include`, `sort` and `filter` parameters applied, and
you can chain `.where()`, scopes and `.paginate()` as usual:

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

**3. Render errors as JSON:API documents.** One branch in your exception handler:

```ts
// app/exceptions/handler.ts
import { renderJsonApiError } from 'jsonapi-adonis'

async handle(error: unknown, ctx: HttpContext) {
  if (ctx.jsonApi.handlesErrors()) {
    return renderJsonApiError(error, ctx, this.debug)
  }
  return super.handle(error, ctx)
}
```

Models without a resource class serialize automatically, with the type, attributes and
relationships derived from Lucid metadata. You only write resource classes to customize.

## Documentation

| Guide                                            | Covers                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [What is JSON:API?](./docs/what-is-jsonapi.md)   | The ideas behind the spec                                                                     |
| [Reading data](./docs/reading-data.md)           | Resources and types, customizing, `include`, sparse fieldsets, sorting, pagination, filtering |
| [Writing data](./docs/writing-data.md)           | Create, update and delete from JSON:API documents, relationship endpoints                     |
| [Links](./docs/links.md)                         | Route-driven URL generation, API versioning, casing                                           |
| [Errors & negotiation](./docs/errors.md)         | Error documents, `handlesErrors()`, media type rules                                          |
| [Low-level building blocks](./docs/low-level.md) | Serializing outside a request: commands, jobs, tests                                          |
| [Reference](./docs/reference.md)                 | The `jsonApi` helper API, configuration, generators, roadmap                                  |

## The example app

[`examples/blog`](./examples/blog) is a complete AdonisJS application (articles, comments,
tags, users) exercising every feature. The same resources are mounted under `/api/v1` and
`/api/v2` to demonstrate versioned links.

```sh
pnpm install
cd examples/blog
node ace migration:run
node ace db:seed        # demo data: authors, articles, tags, comments
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
