import type { HttpContext } from '@adonisjs/core/http'
import type { JsonApiResourceClass } from './registry.ts'

export type LazyResourceImport = () => Promise<{ default: JsonApiResourceClass }>

export type JsonApiConfig = {
  /**
   * Resource classes to register. Models without a registered resource are
   * auto-derived from Lucid metadata.
   */
  resources?: LazyResourceImport[]

  /**
   * Whether to generate resource/relationship links from the named routes
   * registered via router.jsonApiResource(). Defaults to true.
   */
  links?: boolean

  /**
   * Default page size when the client sends page[number] without page[size].
   */
  defaultPageSize?: number

  /**
   * Accept client-generated ids on resource creation. Defaults to false
   * (403 per spec).
   */
  allowClientIds?: boolean

  /**
   * Decides whether an error thrown by a request should render as a
   * JSON:API errors document (used by `ctx.jsonApi.handlesErrors()` in the
   * application exception handler).
   *
   * Defaults to detecting JSON:API requests automatically: the matched
   * route was registered via router.jsonApiResource(), or the client is
   * speaking the JSON:API media type. Override for prefix-based routing:
   *
   * ```ts
   * errorDetection: (ctx) => ctx.request.url().startsWith('/api/')
   * ```
   */
  errorDetection?: (ctx: HttpContext) => boolean
}

export type ResolvedJsonApiConfig = Required<Omit<JsonApiConfig, 'resources' | 'errorDetection'>> &
  Pick<JsonApiConfig, 'resources' | 'errorDetection'>

export function defineConfig(config: JsonApiConfig): ResolvedJsonApiConfig {
  return {
    links: true,
    defaultPageSize: 20,
    allowClientIds: false,
    ...config,
  }
}
