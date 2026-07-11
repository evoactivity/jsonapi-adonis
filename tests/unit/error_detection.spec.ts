import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import type { HttpContext } from '@adonisjs/core/http'
import { JsonApiRequestContext } from '../../src/context.ts'
import { JsonApiRegistry } from '../../src/registry.ts'
import { defineConfig, type JsonApiConfig } from '../../src/define_config.ts'

function makeContext(
  options: {
    routeName?: string
    headers?: Record<string, string>
    config?: JsonApiConfig
  } = {}
) {
  const ctx = new HttpContextFactory().create()
  if (options.routeName) {
    ctx.route = { name: options.routeName } as HttpContext['route']
  }
  Object.assign(ctx.request.request.headers, options.headers ?? {})
  return new JsonApiRequestContext(ctx, new JsonApiRegistry(), defineConfig(options.config ?? {}))
}

test.group('handlesErrors', () => {
  test('true for routes registered via jsonApiResource naming', ({ assert }) => {
    assert.isTrue(makeContext({ routeName: 'api.v1.articles.show' }).handlesErrors())
    assert.isTrue(makeContext({ routeName: 'v2.articles.relationships.replace' }).handlesErrors())
  })

  test('false for unrelated routes without JSON:API media types', ({ assert }) => {
    assert.isFalse(makeContext({ routeName: 'auth.login' }).handlesErrors())
    assert.isFalse(makeContext().handlesErrors())
  })

  test('true when the client speaks the JSON:API media type', ({ assert }) => {
    assert.isTrue(makeContext({ headers: { accept: 'application/vnd.api+json' } }).handlesErrors())
    assert.isTrue(
      makeContext({
        headers: { 'content-type': 'application/vnd.api+json' },
      }).handlesErrors()
    )
  })

  test('the errorDetection config predicate overrides the default', ({ assert }) => {
    const prefixed = makeContext({
      routeName: 'api.v1.articles.show', // would be true by default
      config: { errorDetection: (ctx) => ctx.request.url().startsWith('/admin/') },
    })
    assert.isFalse(prefixed.handlesErrors())

    const always = makeContext({ config: { errorDetection: () => true } })
    assert.isTrue(always.handlesErrors())
  })
})
