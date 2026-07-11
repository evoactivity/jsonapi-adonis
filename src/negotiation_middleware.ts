import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { JsonApiException } from './errors.ts'
import { JSON_API_MEDIA_TYPE } from './types.ts'

/**
 * JSON:API extensions (https://jsonapi.org/format/#extensions) this package
 * understands. The `ext` media type parameter is a semantic contract — a
 * server that does not support a requested extension must reject the
 * request rather than silently process the document without it. The Atomic
 * Operations extension will be registered here when implemented.
 */
export const SUPPORTED_EXTENSIONS: readonly string[] = []

/**
 * JSON:API content negotiation, per https://jsonapi.org/format/#content-negotiation-servers
 *
 * - 415 when the request Content-Type is the JSON:API media type with any
 *   media type parameter other than ext/profile, or with an ext naming an
 *   unsupported extension.
 * - 406 when the Accept header mentions the JSON:API media type and no
 *   instance of it is acceptable (unparameterized, or parameterized only
 *   with profile/supported ext).
 *
 * `profile` is always allowed through — the spec permits servers to ignore
 * profiles they do not recognize.
 */
export default class JsonApiNegotiationMiddleware {
  #supportedExtensions: readonly string[]

  constructor(supportedExtensions: readonly string[] = SUPPORTED_EXTENSIONS) {
    this.#supportedExtensions = supportedExtensions
  }

  handle(ctx: HttpContext, next: NextFn): unknown {
    const contentType = ctx.request.header('content-type')
    if (contentType && this.#isJsonApi(contentType) && !this.#isAcceptable(contentType)) {
      throw new JsonApiException(
        {
          title: 'Unsupported Media Type',
          detail: `The Content-Type header must be "${JSON_API_MEDIA_TYPE}", optionally with profile or supported ext media type parameters`,
          source: { header: 'Content-Type' },
        },
        { status: 415 }
      )
    }

    const accept = ctx.request.header('accept')
    if (accept) {
      const jsonApiInstances = accept
        .split(',')
        .map((instance) => instance.trim())
        .filter((instance) => this.#isJsonApi(instance))
      if (
        jsonApiInstances.length > 0 &&
        !jsonApiInstances.some((instance) => this.#isAcceptable(instance))
      ) {
        throw new JsonApiException(
          {
            title: 'Not Acceptable',
            detail: `The Accept header must include "${JSON_API_MEDIA_TYPE}", optionally with profile or supported ext media type parameters`,
            source: { header: 'Accept' },
          },
          { status: 406 }
        )
      }
    }

    return next() as unknown
  }

  #isJsonApi(mediaType: string): boolean {
    return mediaType.split(';')[0].trim().toLowerCase() === JSON_API_MEDIA_TYPE
  }

  /**
   * A JSON:API media type instance is acceptable when every parameter is
   * either `profile`, a `q` weight (Accept negotiation, not part of the
   * media type), or an `ext` whose extensions are all supported.
   */
  #isAcceptable(mediaType: string): boolean {
    return mediaType
      .split(';')
      .slice(1)
      .every((param) => {
        const [rawName, ...rawValue] = param.split('=')
        const name = rawName.trim().toLowerCase()
        if (name === '' || name === 'q' || name === 'profile') return true
        if (name === 'ext') {
          return this.#extensionsSupported(rawValue.join('='))
        }
        return false
      })
  }

  /**
   * The ext parameter holds one or more space-separated extension URIs,
   * usually quoted: ext="https://jsonapi.org/ext/atomic".
   */
  #extensionsSupported(rawValue: string): boolean {
    const uris = rawValue.trim().replace(/^"|"$/g, '').split(/\s+/).filter(Boolean)
    return uris.length > 0 && uris.every((uri) => this.#supportedExtensions.includes(uri))
  }
}
