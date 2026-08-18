# Reference

## The `jsonApi` context helper

Everything comes from the `jsonApi` context property, installed by the provider. Destructure it as `{ jsonApi }: HttpContext`, or use `ctx.jsonApi`, whichever you prefer:

| Member                                     | What it does                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `params`                                   | Parsed `include` / `fields` / `sort` / `page` / `filter` (throws 400 on malformed input) |
| `page`                                     | `[number, size]` tuple for `query.paginate(...)`                                         |
| `query(Model)`                             | `Model.query()` with include-tree preloads, sorting and declared filters applied         |
| `render(rows, { meta?, links?, status? })` | Build the document, set media type (and `Location` on 201)                               |
| `serialize(rows, extras?)`                 | Build the document without touching the response (pure)                                  |
| `deserialize(Model, { expectedId? })`      | Request body → `{ attributes, toMany, references }`                                      |
| `syncToMany(row, toMany)`                  | Apply deserialized to-many relationships after save                                      |
| `renderRelationship(row, name)`            | Linkage document for `GET …/relationships/:name`                                         |
| `updateRelationship(row, name, action)`    | Apply a relationship write (`'replace' \| 'add' \| 'remove'`)                            |
| `renderRelated(row, name)`                 | Document of the related resources for `GET …/:name`                                      |
| `handlesErrors()`                          | Whether this request's errors render as JSON:API documents                               |
| `links`                                    | The request's `LinkBuilder` (rarely needed directly)                                     |

The builder returned by `query(Model)` is a normal Lucid query builder. Chain `withScopes()` to constrain the primary data, and `withPreloadScopes()` to constrain included relations. See [Scopes on reads](./reading-data.md#scopes-on-reads).

The lower-level building blocks (`DocumentBuilder`, `JsonApiRegistry`, `parseQueryParams`, `deserializeResourceDocument`, `toErrorDocument`, …) are all exported from `@evoactivity/jsonapi-adonis`. Use them to assemble custom behavior. See [Low-level building blocks](./low-level.md) for how to use them outside a request.

## Configuration

```ts
// config/jsonapi.ts
import { defineConfig } from '@evoactivity/jsonapi-adonis'

export default defineConfig({
  /** Resource classes; models without one are auto-derived */
  resources: [() => import('#resources/article_resource')],

  /** Generate links from named routes; false disables links (default true) */
  links: true,

  /** Page size when the client omits page[size] (default 20) */
  defaultPageSize: 20,

  /** Accept client-generated ids on create (default false, which means 403) */
  allowClientIds: false,

  /** When errors render as JSON:API documents (defaults to auto-detection) */
  // errorDetection: (ctx) => ctx.request.url().startsWith('/api/'),
})
```

## Generator commands

```sh
node ace make:jsonapi:resource article                  # resource class + controller
node ace make:jsonapi:resource article --relationships  # + relationship-endpoints controller
node ace make:jsonapi:resource article --no-controller  # resource class only
node ace make:jsonapi:resource article --routes         # also register the routes

node ace make:jsonapi:controller comment                 # controllers only, no resource
node ace make:jsonapi:controller comment -r --routes     #   class (auto-derived resource)
```

For `article`, `make:jsonapi:resource` creates two files. It creates `app/resources/article_resource.ts` (type `articles`, with commented-out attribute and filter customization hooks). It creates `app/controllers/articles_controller.ts` with index/show/store/update/destroy, ready to run. With `--relationships` it also creates `article_relationships_controller.ts`, which serves the `/relationships/:relation` endpoints.

Use `make:jsonapi:controller` when the auto-derived resource is all you need. It generates the controllers without a resource class.

With `--routes`, the command appends a ready-made `router.jsonApiResource(...)` group to `start/routes.ts`. It skips the append if the type is already registered. If you have a versioned API group, move the group inside it. Without the flag, the registration snippets are printed for you to paste.

## Selecting routes

`router.jsonApiResource(type, controllers, options)` registers every route the given controllers have. The third `options` argument limits that with two independent lists. `only` selects resource routes. `relationshipsOnly` selects relationship routes. Each token matches its controller method name.

`only` tokens (the `resource` controller):

| Token     | Method + path          |
| --------- | ---------------------- |
| `index`   | `GET /articles`        |
| `store`   | `POST /articles`       |
| `show`    | `GET /articles/:id`    |
| `update`  | `PATCH /articles/:id`  |
| `destroy` | `DELETE /articles/:id` |

`relationshipsOnly` tokens (the `relationships` controller):

| Token     | Method + path                                  |
| --------- | ---------------------------------------------- |
| `show`    | `GET /articles/:id/relationships/:relation`    |
| `replace` | `PATCH /articles/:id/relationships/:relation`  |
| `add`     | `POST /articles/:id/relationships/:relation`   |
| `remove`  | `DELETE /articles/:id/relationships/:relation` |
| `related` | `GET /articles/:id/:relation`                  |

Omit a list, and every route on that axis registers. Pass it, and only the listed tokens register. The two are independent, so a subset of one leaves the other whole. To keep all resource routes but only the relationship reads:

```ts
router.jsonApiResource(
  'articles',
  {
    resource: () => import('#controllers/articles_controller'),
    relationships: () => import('#controllers/article_relationships_controller'),
  },
  { relationshipsOnly: ['show', 'related'] }
)
```

## Roadmap

- **[Atomic Operations](https://jsonapi.org/ext/atomic/)**, the official JSON:API extension for multiple writes in a single request, applied in one transaction. Either every operation succeeds or none do. This is also the planned answer for the bulk-write cases that individual endpoints handle awkwardly, like clearing or re-parenting a `hasMany` relationship (rejected with `403` today). Those break down cleanly into explicit per-child operations inside one atomic request.
