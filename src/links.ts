import string from '@adonisjs/core/helpers/string'
import type { Links } from './types.ts'

/**
 * Minimal surface of the AdonisJS router used for link generation.
 */
export type RouterContract = {
  find(routeIdentifier: string, domain?: string, method?: string): unknown
  makeUrl(routeIdentifier: string, params?: Record<string, string>): string
}

const RESOURCE_ACTIONS = new Set(['index', 'store', 'show', 'update', 'destroy', 'related'])

/**
 * Generates resource and relationship URLs for one request, from the named
 * routes registered with the `router.jsonApiResource()` helper. The
 * namespace of the CURRENT request's route name is reused, so the same
 * resources served under /api/v1 and /api/v2 groups produce version-correct
 * links — and links are only emitted for routes that actually exist.
 */
export class LinkBuilder {
  #router?: RouterContract
  #enabled: boolean
  #namespace: string[] | null = null

  constructor(enabled: boolean, router?: RouterContract, currentRouteName?: string) {
    this.#enabled = enabled
    this.#router = router
    if (enabled && currentRouteName) {
      this.#namespace = LinkBuilder.namespaceOf(currentRouteName)
    }
  }

  /**
   * Derives the route-name namespace from a route named by
   * `router.jsonApiResource()`:
   *
   *   api.v1.articles.show                    → ['api', 'v1']
   *   api.v1.articles.relationships.replace   → ['api', 'v1']
   *
   * Returns null when the name does not follow the helper's convention.
   */
  static namespaceOf(routeName: string): string[] | null {
    const segments = routeName.split('.')
    if (segments.length >= 3 && segments[segments.length - 2] === 'relationships') {
      return segments.slice(0, -3)
    }
    if (segments.length >= 2 && RESOURCE_ACTIONS.has(segments[segments.length - 1])) {
      return segments.slice(0, -2)
    }
    return null
  }

  get enabled(): boolean {
    return this.#enabled
  }

  #routeUrl(name: string[], params: Record<string, string>): string | undefined {
    if (!this.#enabled || !this.#router || this.#namespace === null) return undefined
    const identifier = [...this.#namespace, ...name].join('.')
    if (!this.#router.find(identifier)) return undefined
    return this.#router.makeUrl(identifier, params)
  }

  /**
   * The `self` URL of a resource, or undefined when its route does not
   * exist (or link generation is disabled).
   */
  resourceSelf(type: string, id: string): string | undefined {
    return this.#routeUrl([type, 'show'], { id })
  }

  resourceLinks(type: string, id: string): Links | undefined {
    const self = this.resourceSelf(type, id)
    return self === undefined ? undefined : { self }
  }

  /**
   * The `self` and `related` links of a relationship. Either link is
   * omitted when its route does not exist. The relation segment is
   * kebab-cased in URLs (receivedComments → received-comments); the
   * relationship endpoints map it back to the Lucid relation name.
   */
  relationshipLinks(type: string, id: string, relation: string): Links | undefined {
    if (!this.#enabled) return undefined
    const segment = string.dashCase(relation)
    const links: Links = {}
    const self = this.#routeUrl([type, 'relationships', 'show'], { id, relation: segment })
    const related = this.#routeUrl([type, 'related'], { id, relation: segment })
    if (self) links.self = self
    if (related) links.related = related
    return Object.keys(links).length ? links : undefined
  }
}
