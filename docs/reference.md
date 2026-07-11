# Reference

## The `jsonApi` context helper

Everything hangs off the `jsonApi` context property, installed by the provider. Destructure
it as `{ jsonApi }: HttpContext` or use `ctx.jsonApi`, whichever you prefer:

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
| `handlesErrors()`                          | Whether this request's errors should render as JSON:API documents                        |
| `links`                                    | The request's `LinkBuilder` (rarely needed directly)                                     |

Lower-level building blocks (`DocumentBuilder`, `JsonApiRegistry`, `parseQueryParams`,
`deserializeResourceDocument`, `toErrorDocument`, …) are all exported from `jsonapi-adonis`
if you need to assemble custom behavior. See
[Low-level building blocks](./low-level.md) for how to use them outside a request.

## Configuration

```ts
// config/jsonapi.ts
import { defineConfig } from 'jsonapi-adonis'

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

For `article`, `make:jsonapi:resource` creates `app/resources/article_resource.ts` (type
`articles`, with commented-out attribute and filter customization hooks) and
`app/controllers/articles_controller.ts` with index/show/store/update/destroy, ready to run.
With `--relationships` it also creates `article_relationships_controller.ts`, serving the
`/relationships/:relation` endpoints.

Use `make:jsonapi:controller` when the auto-derived resource is all you need. It generates
the controllers without a resource class.

With `--routes`, the command appends a ready-made `router.jsonApiResource(...)` group to
`start/routes.ts`, skipping if the type is already registered. Move it inside your versioned
API group if you have one. Without the flag, the registration snippets are printed for you
to paste.

## Roadmap

- **[Atomic Operations](https://jsonapi.org/ext/atomic/)**, the official JSON:API extension
  for performing multiple writes in a single request, applied in one transaction. Either
  every operation succeeds or none do. This is also the planned answer for the bulk-write
  cases individual endpoints handle awkwardly, like clearing or re-parenting a `hasMany`
  relationship (rejected with `403` today), which decomposes cleanly into explicit
  per-child operations inside one atomic request.
