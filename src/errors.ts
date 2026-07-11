import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import { JSON_API_MEDIA_TYPE, JSON_API_VERSION, type Document, type ErrorObject } from './types.ts'

/**
 * An exception that carries JSON:API error objects. Thrown by the plugin
 * itself (invalid include paths, unknown sort fields, ...) and available
 * to userland for custom errors.
 */
export class JsonApiException extends Exception {
  static status = 400
  static code = 'E_JSON_API_ERROR'

  errors: ErrorObject[]

  constructor(errors: ErrorObject | ErrorObject[], options?: { status?: number; code?: string }) {
    const list = Array.isArray(errors) ? errors : [errors]
    super(list[0]?.title ?? 'JSON:API error', options)
    this.errors = list.map((error) => ({
      status: String(options?.status ?? (this.constructor as typeof JsonApiException).status),
      ...error,
    }))
  }

  static invalidQueryParameter(parameter: string, detail: string) {
    return new this(
      { title: 'Invalid Query Parameter', detail, source: { parameter } },
      { status: 400 }
    )
  }
}

/**
 * Converts any thrown error into a JSON:API errors document. Wired into the
 * application exception handler so every error response is spec-compliant.
 */
export function toErrorDocument(
  error: unknown,
  debug: boolean
): { status: number; body: Document } {
  const errors: ErrorObject[] = []
  let status = 500

  if (error instanceof JsonApiException) {
    status = error.status
    errors.push(...error.errors)
  } else if (isVineValidationError(error)) {
    status = 422
    for (const message of error.messages) {
      errors.push({
        status: '422',
        code: message.rule,
        title: 'Validation Failure',
        detail: message.message,
        source: { pointer: `/data/attributes/${String(message.field).replaceAll('.', '/')}` },
      })
    }
  } else if (isHttpError(error)) {
    status = error.status
    errors.push({
      status: String(error.status),
      code: error.code,
      title: httpTitle(error.status),
      detail: status < 500 || debug ? error.message : undefined,
    })
  } else {
    errors.push({
      status: '500',
      title: 'Internal Server Error',
      detail: debug && error instanceof Error ? error.message : undefined,
    })
  }

  return {
    status,
    body: { jsonapi: { version: JSON_API_VERSION }, errors },
  }
}

/**
 * Sends a JSON:API error response for the given error. Returns false when
 * the request did not ask for JSON so the default handler can render it.
 */
export function renderJsonApiError(error: unknown, ctx: HttpContext, debug: boolean) {
  const { status, body } = toErrorDocument(error, debug)
  ctx.response.status(status)
  ctx.response.header('content-type', JSON_API_MEDIA_TYPE)
  ctx.response.send(JSON.stringify(body))
}

function isVineValidationError(
  error: unknown
): error is { messages: Array<{ message: string; rule: string; field: string }> } {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'E_VALIDATION_ERROR' &&
    'messages' in error &&
    Array.isArray((error as { messages?: unknown }).messages)
  )
}

function isHttpError(error: unknown): error is Error & { status: number; code?: string } {
  return error instanceof Error && typeof (error as { status?: unknown }).status === 'number'
}

function httpTitle(status: number) {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    409: 'Conflict',
    415: 'Unsupported Media Type',
    422: 'Unprocessable Content',
    500: 'Internal Server Error',
  }
  return titles[status] ?? 'Error'
}
