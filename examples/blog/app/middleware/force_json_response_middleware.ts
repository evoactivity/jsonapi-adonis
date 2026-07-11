import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class ForceJsonResponseMiddleware {
  handle(ctx: HttpContext, next: NextFn) {
    /**
     * Preserve the original Accept header when the client speaks JSON:API,
     * so content negotiation (406 on parameterized media types) still works.
     */
    const accept = ctx.request.request.headers.accept
    if (!accept || !accept.includes('application/vnd.api+json')) {
      ctx.request.request.headers.accept = 'application/json'
    }
    return next()
  }
}
