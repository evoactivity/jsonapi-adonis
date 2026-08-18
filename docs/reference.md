# Reference

## The `jsonApi` context helper

The provider installs `jsonApi` on every HttpContext. Destructure it as `{ jsonApi }: HttpContext`, or read `ctx.jsonApi`:

| Member                                               | What it does                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `params`                                             | Parsed `include` / `fields` / `sort` / `page` / `filter` (throws `400` on bad input) |
| `page`                                               | `[number, size]` tuple for `query.paginate(...)`                                     |
| `query(Model)`                                       | `Model.query()` with include preloads, sorting, and declared filters applied         |
| `render(rows, { meta?, links?, status? })`           | Build the document, set the media type, and the `Location` header on `201`           |
| `serialize(rows, extras?)`                           | Build the document without touching the response (pure)                              |
| `deserialize(Model, { expectedId?, expectedType? })` | Request body → `{ id?, type, attributes, toMany, references }`                       |
| `syncToMany(row, toMany)`                            | Apply deserialized to-many relationships after save                                  |
| `renderRelationship(row, name)`                      | Linkage document for `GET …/relationships/:name`                                     |
| `updateRelationship(row, name, action)`              | Apply a relationship write (`'replace' \| 'add' \| 'remove'`)                        |
| `renderRelated(row, name)`                           | Document of the related resources for `GET …/:name`                                  |
| `handlesErrors()`                                    | Whether this request's errors should render as JSON:API documents                    |
| `links`                                              | The request's `LinkBuilder` (rarely needed directly)                                 |

`query(Model)` returns a normal Lucid builder. Chain `withScopes()` for the root query and `withPreloadScopes()` for the include preloads. See [Scopes](./scopes.md). The lower-level exports (`DocumentBuilder`, `JsonApiRegistry`, `parseQueryParams`, `deserializeResourceDocument`, `toErrorDocument`) let you assemble custom behavior. See [Building blocks](./low-level.md).

## Configuration

```ts
// config/jsonapi.ts
import { defineConfig } from '@evoactivity/jsonapi-adonis'

export default defineConfig({
  /** Resource classes; a model without one is auto-derived */
  resources: [() => import('#resources/article_resource')],

  /** Generate links from named routes; false disables links (default true) */
  links: true,

  /** Page size when the client omits page[size] (default 20) */
  defaultPageSize: 20,

  /** Accept client-generated ids on create (default false, which means 403) */
  allowClientIds: false,

  /** When errors render as JSON:API documents (default: auto-detection) */
  // errorDetection: (ctx) => ctx.request.url().startsWith('/api/'),
})
```

## Generator commands

```sh
node ace make:jsonapi:resource article                  # resource class + controller
node ace make:jsonapi:resource article --relationships  # + relationship-endpoints controller
node ace make:jsonapi:resource article --no-controller  # resource class only
node ace make:jsonapi:resource article --routes         # also register the routes

node ace make:jsonapi:controller comment                # controllers only, no resource
node ace make:jsonapi:controller comment -r --routes    # relationships controller + routes
```

`make:jsonapi:resource article` writes `app/resources/article_resource.ts` (type `articles`, with commented-out attribute and filter hooks) and `app/controllers/articles_controller.ts` (index/show/store/update/destroy). With `--relationships` it also writes `article_relationships_controller.ts` for the `/relationships/:relation` endpoints.

Use `make:jsonapi:controller` when the auto-derived resource is enough. It writes only the controllers.

With `--routes`, the command appends a `router.jsonApiResource(...)` group to `start/routes.ts`, skipping the append when the type is already registered. Move the group inside your versioned API group. Without the flag, the registration snippet is printed for you to paste. Both commands take `-f` (`--force`) to overwrite existing files.

## Selecting routes

`router.jsonApiResource(type, controllers, options)` registers every route the given controllers have. The third argument narrows that with two independent lists. `only` selects resource routes. `relationshipsOnly` selects relationship routes. Each token is a controller method name.

`only` tokens (the `resource` controller):

| Token     | Method and path        |
| --------- | ---------------------- |
| `index`   | `GET /articles`        |
| `store`   | `POST /articles`       |
| `show`    | `GET /articles/:id`    |
| `update`  | `PATCH /articles/:id`  |
| `destroy` | `DELETE /articles/:id` |

`relationshipsOnly` tokens (the `relationships` controller):

| Token     | Method and path                                |
| --------- | ---------------------------------------------- |
| `show`    | `GET /articles/:id/relationships/:relation`    |
| `replace` | `PATCH /articles/:id/relationships/:relation`  |
| `add`     | `POST /articles/:id/relationships/:relation`   |
| `remove`  | `DELETE /articles/:id/relationships/:relation` |
| `related` | `GET /articles/:id/:relation`                  |

Omit a list, and every route on that axis registers. Pass it, and only the listed tokens register. The two lists are independent, so narrowing one leaves the other whole. To keep every resource route but only the relationship reads:

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

- **[Atomic Operations](https://jsonapi.org/ext/atomic/)**, the official extension for several writes in one request, applied in one transaction. Either every operation succeeds or none do. This is the planned home for the bulk-write cases a single endpoint handles awkwardly, like clearing or re-parenting a `hasMany` (a `403` today), which break down cleanly into per-child operations inside one atomic request.

---

Back to the [README](../README.md) · [Concepts](./concepts.md) · [Getting started](./getting-started.md)
