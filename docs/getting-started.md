# Getting started

This guide goes from install to a working endpoint. It assumes AdonisJS v7, Lucid v22, and at least one model.

## 1. Install

```sh
node ace add @evoactivity/jsonapi-adonis
```

The `add` command runs the package's configure step. That step does four things:

- writes `config/jsonapi.ts`
- registers the provider
- registers the generator commands
- registers a named middleware called `jsonApi`

After it finishes, `ctx.jsonApi` exists on every request.

## 2. Generate a resource and controllers

```sh
node ace make:jsonapi:resource article --relationships --routes
```

This writes `app/resources/article_resource.ts`, an `articles` controller with index/show/store/update/destroy, and (from `--relationships`) a relationships controller. `--routes` appends a `router.jsonApiResource(...)` group to `start/routes.ts`. The command then prints the config line to add:

```ts
// config/jsonapi.ts
export default defineConfig({
  resources: [() => import('#resources/article_resource')],
})
```

> [!NOTE]
> Resource classes are optional. Every model serializes from Lucid metadata alone, so a controller is enough on its own. `node ace make:jsonapi:controller article` generates only the controllers, and you register nothing in the config. You write a resource class only to change the output. See [Resources](./resources.md).

## 3. Apply the middleware

The `jsonApi` middleware runs content negotiation. Put your resource routes in a group and apply it. Name the group, because link generation reads the name:

```ts
// start/routes.ts
import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'

router
  .group(() => {
    router.jsonApiResource('articles', {
      resource: () => import('#controllers/articles_controller'),
      relationships: () => import('#controllers/article_relationships_controller'),
    })
  })
  .prefix('/api/v1')
  .as('api.v1')
  .use(middleware.jsonApi())
```

The `.as('api.v1')` name drives the URLs in every document. See [Links](./links.md).

## 4. Make a request

```
GET /api/v1/articles/1?include=author,tags
```

The generated controller is plain AdonisJS:

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
}
```

`jsonApi.query(Article)` returns `Article.query()` with the request's `include`, `sort`, and `filter` already applied, so you can chain `.where()` and `.paginate()` as usual. `jsonApi.render(...)` builds the document and sets the `application/vnd.api+json` content type. The response holds the article in `data`, the author and tags in `included` with duplicates removed, the linkage, and the links. Unknown include paths get a `400`, and there are no N+1 queries.

## 5. Render errors as JSON:API documents

Add one branch to your exception handler:

```ts
// app/exceptions/handler.ts
import { renderJsonApiError } from '@evoactivity/jsonapi-adonis'

async handle(error: unknown, ctx: HttpContext) {
  if (ctx.jsonApi.handlesErrors()) {
    return renderJsonApiError(error, ctx, this.debug)
  }
  return super.handle(error, ctx)
}
```

`handlesErrors()` returns true for a JSON:API request. A validation error then becomes a `422` document with one pointer per failed field, and any other error maps to its status. See [Errors and negotiation](./errors.md).

## Next steps

- [Resources](./resources.md): change how a model serializes.
- [Queries](./queries.md): `include`, sparse fieldsets, sorting, pagination, filtering.
- [Writes](./writes.md): create, update, delete, and the relationship endpoints.

---

Next: [Resources](./resources.md) · [Queries](./queries.md) · [Writes](./writes.md) · [Reference](./reference.md)
