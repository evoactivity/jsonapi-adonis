/**
 * Route registration helper. Installed as a router macro by the provider:
 *
 * ```ts
 * router
 *   .group(() => {
 *     router.jsonApiResource('articles', {
 *       resource: () => import('#controllers/articles_controller'),
 *       relationships: () => import('#controllers/article_relationships_controller'),
 *     })
 *   })
 *   .prefix('/api/v1')
 *   .as('api.v1')
 * ```
 *
 * Routes are named `<type>.<action>` (prefixed by the enclosing groups'
 * `.as()` names), which is the convention the LinkBuilder uses to generate
 * version-correct URLs and to omit links for unregistered routes.
 */

/**
 * Resource controller actions, matching its method names. Selected with the
 * `only` option.
 */
export type ResourceActions = 'index' | 'show' | 'store' | 'update' | 'destroy'

/**
 * Relationship controller actions, matching its method names. Selected with
 * the `relationshipsOnly` option. `show`/`replace`/`add`/`remove` serve
 * `/:id/relationships/:relation`; `related` serves `/:id/:relation`.
 */
export type RelationshipActions = 'show' | 'replace' | 'add' | 'remove' | 'related'

export type JsonApiResourceControllers = {
  /**
   * Controller with index/show/store/update/destroy actions (any subset,
   * limited via `only`).
   */
  resource?: LazyController
  /**
   * Controller with show/replace/add/remove/related actions serving
   * `/:id/relationships/:relation` and `/:id/:relation` routes (any subset,
   * limited via `relationshipsOnly`).
   */
  relationships?: LazyController
}

export type JsonApiResourceOptions = {
  /**
   * Register only the listed resource routes. Omit to register every action
   * the `resource` controller supports.
   */
  only?: ResourceActions[]
  /**
   * Register only the listed relationship routes. Omit to register every
   * action the `relationships` controller supports.
   */
  relationshipsOnly?: RelationshipActions[]
}

type ControllerConstructor = new (...args: never[]) => unknown

type LazyController = () => Promise<{ default: ControllerConstructor }>

/**
 * Structural slice of an AdonisJS route: naming it and attaching
 * middleware, which is all the helper and the returned routes need.
 */
type RouteLike = {
  as(name: string): RouteLike
  use(middleware: never): unknown
}

/**
 * Structural slice of the AdonisJS router used by the helper. The handler
 * is typed loosely (unknown) because the real router accepts a wide union;
 * this helper only ever passes [LazyController, actionName] tuples.
 */
type RouterLike = {
  get(pattern: string, handler: unknown): RouteLike
  post(pattern: string, handler: unknown): RouteLike
  patch(pattern: string, handler: unknown): RouteLike
  delete(pattern: string, handler: unknown): RouteLike
}

/**
 * The routes one `jsonApiResource()` call registered, kept by action so
 * middleware can be attached to some of them. Modelled on AdonisJS's own
 * `RouteResource.use()`. Each call returns the same object, so calls
 * chain. Naming an action that was not registered (left out with `only`
 * or `relationshipsOnly`) does nothing.
 *
 * Middleware attached here is route middleware, so it runs after the
 * middleware of the groups the resource sits in.
 *
 * ```ts
 * router
 *   .jsonApiResource('articles', { resource, relationships })
 *   .use(['store', 'update', 'destroy'], middleware.auth())
 *   .useRelationships(['replace', 'add', 'remove'], middleware.auth())
 * ```
 */
export class JsonApiResourceRoutes<Middleware = never> {
  #resource = new Map<ResourceActions, RouteLike>()
  #relationships = new Map<RelationshipActions, RouteLike>()

  /** @internal Called by registerJsonApiResource as it registers each route. */
  addResource(action: ResourceActions, route: RouteLike) {
    this.#resource.set(action, route)
  }

  /** @internal Called by registerJsonApiResource as it registers each route. */
  addRelationship(action: RelationshipActions, route: RouteLike) {
    this.#relationships.set(action, route)
  }

  /** Attaches middleware to the listed resource routes, or all of them with '*'. */
  use(actions: ResourceActions[] | '*', middleware: Middleware): this {
    attach(this.#resource, actions, middleware)
    return this
  }

  /** Attaches middleware to the listed relationship routes, or all of them with '*'. */
  useRelationships(actions: RelationshipActions[] | '*', middleware: Middleware): this {
    attach(this.#relationships, actions, middleware)
    return this
  }
}

function attach<Action extends string>(
  routes: Map<Action, RouteLike>,
  actions: Action[] | '*',
  middleware: unknown
) {
  for (const [action, route] of routes) {
    if (actions === '*' || actions.includes(action)) {
      route.use(middleware as never)
    }
  }
}

export function registerJsonApiResource<Middleware = never>(
  router: RouterLike,
  type: string,
  controllers: JsonApiResourceControllers,
  options: JsonApiResourceOptions = {}
): JsonApiResourceRoutes<Middleware> {
  const { resource, relationships } = controllers
  const routes = new JsonApiResourceRoutes<Middleware>()
  const wantsResource = (action: ResourceActions) => !options.only || options.only.includes(action)
  const wantsRelationship = (action: RelationshipActions) =>
    !options.relationshipsOnly || options.relationshipsOnly.includes(action)

  if (resource) {
    if (wantsResource('index')) {
      routes.addResource('index', router.get(type, [resource, 'index']).as(`${type}.index`))
    }
    if (wantsResource('store')) {
      routes.addResource('store', router.post(type, [resource, 'store']).as(`${type}.store`))
    }
    if (wantsResource('show')) {
      routes.addResource('show', router.get(`${type}/:id`, [resource, 'show']).as(`${type}.show`))
    }
    if (wantsResource('update')) {
      routes.addResource(
        'update',
        router.patch(`${type}/:id`, [resource, 'update']).as(`${type}.update`)
      )
    }
    if (wantsResource('destroy')) {
      routes.addResource(
        'destroy',
        router.delete(`${type}/:id`, [resource, 'destroy']).as(`${type}.destroy`)
      )
    }
  }

  if (relationships) {
    if (wantsRelationship('show')) {
      routes.addRelationship(
        'show',
        router
          .get(`${type}/:id/relationships/:relation`, [relationships, 'show'])
          .as(`${type}.relationships.show`)
      )
    }
    if (wantsRelationship('replace')) {
      routes.addRelationship(
        'replace',
        router
          .patch(`${type}/:id/relationships/:relation`, [relationships, 'replace'])
          .as(`${type}.relationships.replace`)
      )
    }
    if (wantsRelationship('add')) {
      routes.addRelationship(
        'add',
        router
          .post(`${type}/:id/relationships/:relation`, [relationships, 'add'])
          .as(`${type}.relationships.add`)
      )
    }
    if (wantsRelationship('remove')) {
      routes.addRelationship(
        'remove',
        router
          .delete(`${type}/:id/relationships/:relation`, [relationships, 'remove'])
          .as(`${type}.relationships.remove`)
      )
    }
    if (wantsRelationship('related')) {
      routes.addRelationship(
        'related',
        router.get(`${type}/:id/:relation`, [relationships, 'related']).as(`${type}.related`)
      )
    }
  }

  return routes
}
