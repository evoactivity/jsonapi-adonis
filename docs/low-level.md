# The building blocks for use outside a request

The `jsonApi` context helper is a thin facade. Everything it does is built from exported pieces you can compose yourself. You use these pieces to produce or consume JSON:API documents where there is no HTTP request: ace commands, queue jobs, scheduled tasks, tests, webhook processors, or static exports for a frontend.

## The pieces

| Export                                                                 | Role                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `JsonApiRegistry`                                                      | Maps models to resource classes, derives types, auto-creates resources for unregistered models    |
| `DocumentBuilder`                                                      | Turns rows or a paginator into a compound document (`data`, deduped `included`, sparse fieldsets) |
| `LinkBuilder`                                                          | Route-driven URL generation (or `new LinkBuilder(false)` for none)                                |
| `parseQueryParams`                                                     | `{ include, fields, sort, page, filter }` from a plain object, with spec validation               |
| `validateIncludeTree` / `applyIncludes` / `applySort` / `applyFilters` | Apply parsed params to a Lucid query                                                              |
| `deserializeResourceDocument` / `verifyRelatedExist`                   | Request document to model attributes + to-many ids                                                |
| `toErrorDocument`                                                      | Any thrown error to a `{ status, body }` errors document (pure)                                   |
| `JsonApiResource`, `filter`, `JsonApiException`, document types        | The same classes and types used everywhere else                                                   |

## Getting the configured registry

The provider binds its registry, with every resource class from `config/jsonapi.ts` registered, into the container as a singleton keyed by the class itself:

```ts
import { JsonApiRegistry } from '@evoactivity/jsonapi-adonis'

const registry = await app.container.make(JsonApiRegistry)
```

You can also construct a fresh `new JsonApiRegistry()` and `.register([...])` resource classes by hand. This is useful in unit tests, or when you want different resources than the HTTP layer shows.

## Serializing without a request

Here is a complete, runnable example: an ace command that exports articles as a JSON:API document. This exact command is in the example app as `examples/blog/commands/export_articles.ts`.

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
  static options: CommandOptions = { startApp: true } // boot DB + provider

  @flags.string({ description: 'Include paths (same syntax as ?include=)', default: 'author' })
  declare include: string

  async run() {
    const { default: Article } = await import('#models/article')
    const registry = await this.app.container.make(JsonApiRegistry)

    // Reuse the query-parameter machinery: parse and validate include paths.
    // Passing the registry makes validation respect exposeRelationships;
    // without it only the model's relations are checked.
    const params = parseQueryParams({ include: this.include })
    validateIncludeTree(Article, params.include, registry)

    // Preload the include tree, then fetch. The cast is the same variance
    // bridge ctx.jsonApi.query() uses internally: Lucid types preload()
    // with literal relation names, while include trees work with strings.
    const query = Article.query()
    applyIncludes(query as unknown as DynamicModelQuery, params.include)
    const articles = await query

    // No request means no route namespace, so turn link generation off
    const document = new DocumentBuilder(registry, params, new LinkBuilder(false)).build(articles)

    this.logger.log(JSON.stringify(document, null, 2))
  }
}
```

```sh
node ace export:articles --include=author,tags
```

The same pattern works anywhere you have a booted application. Build `params`, either from user input via `parseQueryParams` or by constructing the object directly. Preload what the include tree needs, and give the rows to a `DocumentBuilder`.

`build()` accepts a single row, an array, a Lucid paginator, or `null`, plus optional top-level extras: `builder.build(rows, { meta: { exportedAt: ... }, links: { ... } })`.

## Links outside a request

Inside a request, links are namespaced by the route that served it. Outside a request there is no "current route", which leaves you two options:

- **No links.** `new LinkBuilder(false)`. Usually right for exports and jobs.
- **Anchor to a route group yourself.** Pass the router service and any route name from the group whose URLs you want:

  ```ts
  import router from '@adonisjs/core/services/router'

  const links = new LinkBuilder(true, router, 'api.v1.articles.show')
  ```

  Every generated link now resolves against the `api.v1` group's named routes, exactly as if the document were rendered by a request to that group. The existence checks still apply, and resources without registered routes get no links.

## Deserializing without a request

Useful for queue-delivered payloads or webhook bodies that carry JSON:API documents:

```ts
import {
  deserializeResourceDocument,
  verifyRelatedExist,
  JsonApiRegistry,
} from '@evoactivity/jsonapi-adonis'

const registry = await app.container.make(JsonApiRegistry)
const input = deserializeResourceDocument(Article, registry, payload, {
  allowClientIds: false,
})
await verifyRelatedExist(Article, input.references, registry) // 404-style JsonApiException if missing

const article = await Article.create(input.attributes)
```

All the write-side error semantics apply (400/403/409, and 404 via `verifyRelatedExist`). Failures throw `JsonApiException`, which carries ready-made error objects.

## Error documents anywhere

`toErrorDocument(error, debug)` is pure. It maps any thrown value to `{ status, body }`, where `body` is a spec-compliant errors document. This is useful for jobs that report failures in JSON:API shape, or for testing error mappings without a server:

```ts
import { toErrorDocument } from '@evoactivity/jsonapi-adonis'

const { status, body } = toErrorDocument(error, false)
```

## Caveats

- **Pagination links need a request.** `first`, `prev`, `next`, and `last` are built from the request URL and query string. Without a ctx they are `null`, but the `meta.page` totals are still emitted. If you need the links, pass your own via `build(rows, { links: { ... } })`.
- **`this.ctx` is `undefined` in resource classes** during ctx-less serialization. If `attributes()` and `meta()` use it, guard them with `this.ctx?.auth...`.
- **Boot the app first.** Resource classes are registered in the provider's `ready` phase, and models need the database. In ace commands, set `static options = { startApp: true }`.

---

Back to the [reference](./reference.md) · [README](../README.md)
