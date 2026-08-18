# Building blocks

`ctx.jsonApi` is a thin composition of exported pieces. `query()` is `parseQueryParams` plus `validateIncludeTree`, `applyIncludes`, `applySort`, and `applyFilters`. `render()` is a `DocumentBuilder` and a `LinkBuilder`. `deserialize()` is `deserializeResourceDocument` plus `verifyRelatedExist`. Every piece is exported, so you can produce or consume JSON:API documents where there is no request: an ace command, a queue job, a scheduled task, a test, a webhook body, or a static export.

## The pieces

| Export                                                                 | Role                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `JsonApiRegistry`                                                      | Maps models to resource classes; auto-derives the rest; resolves a row's concrete type |
| `DocumentBuilder`                                                      | Rows or a paginator to a compound document (`data`, deduped `included`, sparse fields) |
| `LinkBuilder`                                                          | Route-driven URLs, or `new LinkBuilder(false)` for none                                |
| `parseQueryParams`                                                     | A plain object to `{ include, fields, sort, page, filter }`, validated                 |
| `validateIncludeTree` / `applyIncludes` / `applySort` / `applyFilters` | Apply parsed params to a Lucid query                                                   |
| `deserializeResourceDocument` / `verifyRelatedExist`                   | A request document to attributes plus to-many ids, then existence checks               |
| `toErrorDocument`                                                      | Any thrown value to a `{ status, body }` error document (pure)                         |
| `JsonApiResource`, `filter`, `JsonApiException`, document types        | The same classes and types used everywhere else                                        |

## Get the configured registry

The provider registers a `JsonApiRegistry` singleton, holding every resource class from `config/jsonapi.ts`. Resolve it from the container to reuse exactly what the HTTP layer uses:

```ts
import { JsonApiRegistry } from '@evoactivity/jsonapi-adonis'

const registry = await app.container.make(JsonApiRegistry)
```

For a different set of resources, build one by hand: `new JsonApiRegistry().register([...])`. This is useful in a unit test, or when a job needs a narrower view than the API exposes.

## Serialize without a request

This command ships in the example app as `examples/blog/commands/export_articles.ts`. It builds a document by driving the same pieces `ctx.jsonApi` composes:

```ts
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import {
  DocumentBuilder,
  JsonApiRegistry,
  LinkBuilder,
  applyIncludes,
  parseQueryParams,
  validateIncludeTree,
  type DynamicModelQuery,
} from '@evoactivity/jsonapi-adonis'

export default class ExportArticles extends BaseCommand {
  static commandName = 'export:articles'
  static description = 'Export all articles as a JSON:API document to stdout'
  static options: CommandOptions = { startApp: true } // boot the DB and provider

  @flags.string({ description: 'Include paths (same syntax as ?include=)', default: 'author' })
  declare include: string

  async run() {
    const { default: Article } = await import('#models/article')
    const registry = await this.app.container.make(JsonApiRegistry)

    // Parse and validate include paths. Passing the registry makes
    // validation respect exposeRelationships, as a request would.
    const params = parseQueryParams({ include: this.include })
    validateIncludeTree(Article, params.include, registry)

    // Preload the include tree, then fetch. The cast is the same variance
    // bridge ctx.jsonApi.query() uses: Lucid types preload() with literal
    // relation names, while an include tree works with strings.
    const query = Article.query()
    applyIncludes(query as unknown as DynamicModelQuery, params.include)
    const articles = await query

    // No request means no route namespace, so turn links off.
    const document = new DocumentBuilder(registry, params, new LinkBuilder(false)).build(articles)

    this.logger.log(JSON.stringify(document, null, 2))
  }
}
```

```sh
node ace export:articles --include=author,tags
```

The pattern is the same anywhere the app is booted. Build `params`, from user input via `parseQueryParams` or by hand. Preload what the include tree needs. Hand the rows to a `DocumentBuilder`. `build()` accepts a single row, an array, a Lucid paginator, or `null`, plus top-level extras: `build(rows, { meta: { exportedAt }, links: {} })`.

## Links without a request

Inside a request, links are namespaced by the route that served it. Outside a request there is no current route, so you choose:

- **No links.** `new LinkBuilder(false)`. Usually right for an export or a job.
- **Anchor to a group.** Pass the router and any route name from the group whose URLs you want:

  ```ts
  import router from '@adonisjs/core/services/router'

  const links = new LinkBuilder(true, router, 'api.v1.articles.show')
  ```

  Every link now resolves against the `api.v1` group, as if a request to that group produced the document. The existence checks still apply, so a model with no routes gets no links.

## Deserialize without a request

For a queue payload or a webhook body that carries a JSON:API document:

```ts
import {
  deserializeResourceDocument,
  verifyRelatedExist,
  JsonApiRegistry,
} from '@evoactivity/jsonapi-adonis'

const registry = await app.container.make(JsonApiRegistry)
const input = deserializeResourceDocument(Article, registry, payload, { allowClientIds: false })
await verifyRelatedExist(Article, input.references, registry) // 404-style throw if missing

const article = await Article.create(input.attributes)
```

The same error rules apply (`400`/`403`/`409`, and `404` from `verifyRelatedExist`). A failure throws a `JsonApiException` carrying ready-made error objects. See [Writes](./writes.md#the-write-error-rules).

## Error documents anywhere

`toErrorDocument(error, debug)` is pure. It maps any thrown value to `{ status, body }`, where `body` is a spec-compliant error document. Useful for a job that reports failures in JSON:API shape, or a test that checks an error mapping with no server:

```ts
const { status, body } = toErrorDocument(error, false)
```

## Caveats

- **Pagination links need a request.** `first`/`prev`/`next`/`last` are built from the request URL. Without a ctx they come out `null`, though `meta.page` totals still appear. Pass your own via `build(rows, { links: {} })` if you need them.
- **`this.ctx` is `undefined` in a resource class** during ctx-less serialization. If `attributes()` or `meta()` read it, guard with `this.ctx?.auth...`.
- **Boot the app first.** Resource classes register in the provider's `ready` phase, and models need the database. In an ace command, set `static options = { startApp: true }`.

---

Back to the [Reference](./reference.md) · [README](../README.md)
