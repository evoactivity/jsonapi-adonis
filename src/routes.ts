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

export type ResourceActions = 'index' | 'show' | 'store' | 'update' | 'destroy'

export type JsonApiResourceControllers = {
  /**
   * Controller with index/show/store/update/destroy actions (any subset,
   * limited via `only`).
   */
  resource?: LazyController
  /**
   * Controller with show/replace/add/remove/related actions serving
   * `/:id/relationships/:relation` and `/:id/:relation` routes.
   */
  relationships?: LazyController
}

export type JsonApiResourceOptions = {
  only?: ResourceActions[]
}

type ControllerConstructor = new (...args: never[]) => unknown

type LazyController = () => Promise<{ default: ControllerConstructor }>

/**
 * Structural slice of the AdonisJS router used by the helper. The handler
 * is typed loosely (unknown) because the real router accepts a wide union;
 * this helper only ever passes [LazyController, actionName] tuples.
 */
type RouterLike = {
  get(pattern: string, handler: unknown): { as(name: string): unknown }
  post(pattern: string, handler: unknown): { as(name: string): unknown }
  patch(pattern: string, handler: unknown): { as(name: string): unknown }
  delete(pattern: string, handler: unknown): { as(name: string): unknown }
}

export function registerJsonApiResource(
  router: RouterLike,
  type: string,
  controllers: JsonApiResourceControllers,
  options: JsonApiResourceOptions = {}
): void {
  const { resource, relationships } = controllers
  const wants = (action: ResourceActions) => !options.only || options.only.includes(action)

  if (resource) {
    if (wants('index')) router.get(type, [resource, 'index']).as(`${type}.index`)
    if (wants('store')) router.post(type, [resource, 'store']).as(`${type}.store`)
    if (wants('show')) router.get(`${type}/:id`, [resource, 'show']).as(`${type}.show`)
    if (wants('update')) router.patch(`${type}/:id`, [resource, 'update']).as(`${type}.update`)
    if (wants('destroy')) {
      router.delete(`${type}/:id`, [resource, 'destroy']).as(`${type}.destroy`)
    }
  }

  if (relationships) {
    router
      .get(`${type}/:id/relationships/:relation`, [relationships, 'show'])
      .as(`${type}.relationships.show`)
    router
      .patch(`${type}/:id/relationships/:relation`, [relationships, 'replace'])
      .as(`${type}.relationships.replace`)
    router
      .post(`${type}/:id/relationships/:relation`, [relationships, 'add'])
      .as(`${type}.relationships.add`)
    router
      .delete(`${type}/:id/relationships/:relation`, [relationships, 'remove'])
      .as(`${type}.relationships.remove`)
    router.get(`${type}/:id/:relation`, [relationships, 'related']).as(`${type}.related`)
  }
}
