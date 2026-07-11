import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import JsonApiNegotiationMiddleware from '../../src/negotiation_middleware.ts'
import { JsonApiException } from '../../src/errors.ts'

async function runMiddleware(headers: Record<string, string>, supportedExtensions?: string[]) {
  const ctx = new HttpContextFactory().create()
  Object.assign(ctx.request.request.headers, headers)
  let passed = false
  await new JsonApiNegotiationMiddleware(supportedExtensions).handle(ctx, () => {
    passed = true
  })
  return passed
}

async function expectStatus(
  headers: Record<string, string>,
  status: number,
  supportedExtensions?: string[]
) {
  try {
    await runMiddleware(headers, supportedExtensions)
  } catch (error) {
    if (error instanceof JsonApiException) return error.status
    throw error
  }
  throw new Error(`Expected a ${status} JsonApiException`)
}

test.group('Content negotiation middleware', () => {
  test('passes requests without JSON:API media types', async ({ assert }) => {
    assert.isTrue(await runMiddleware({}))
    assert.isTrue(await runMiddleware({ accept: 'application/json' }))
    assert.isTrue(await runMiddleware({ 'content-type': 'application/json' }))
  })

  test('passes clean JSON:API media types', async ({ assert }) => {
    assert.isTrue(
      await runMiddleware({
        'accept': 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
      })
    )
  })

  test('415 when Content-Type carries unknown media type parameters', async ({ assert }) => {
    assert.equal(
      await expectStatus({ 'content-type': 'application/vnd.api+json; unsupported=1' }, 415),
      415
    )
  })

  test('406 when every JSON:API Accept instance is parameterized', async ({ assert }) => {
    assert.equal(
      await expectStatus({ accept: 'application/vnd.api+json; unsupported=1' }, 406),
      406
    )
  })

  test('passes when at least one JSON:API Accept instance is clean', async ({ assert }) => {
    assert.isTrue(
      await runMiddleware({
        accept: 'application/vnd.api+json; unsupported=1, application/vnd.api+json',
      })
    )
  })

  test('profile media type parameters are always allowed', async ({ assert }) => {
    assert.isTrue(
      await runMiddleware({
        'accept': 'application/vnd.api+json; profile="https://example.com/x"',
        'content-type': 'application/vnd.api+json; profile="https://example.com/y"',
      })
    )
  })

  test('unsupported extensions are rejected (415 Content-Type, 406 Accept)', async ({ assert }) => {
    // The package currently supports no extensions, so any ext is a contract
    // we cannot honor — processing the document anyway would misinterpret it
    assert.equal(
      await expectStatus(
        { 'content-type': 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"' },
        415
      ),
      415
    )
    assert.equal(
      await expectStatus(
        { accept: 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"' },
        406
      ),
      406
    )
  })

  test('supported extensions are accepted', async ({ assert }) => {
    const atomic = 'https://jsonapi.org/ext/atomic'
    assert.isTrue(
      await runMiddleware(
        {
          'accept': `application/vnd.api+json; ext="${atomic}"`,
          'content-type': `application/vnd.api+json; ext="${atomic}"`,
        },
        [atomic]
      )
    )
    // one supported + one unsupported URI in the same ext list → still rejected
    assert.equal(
      await expectStatus(
        { 'content-type': `application/vnd.api+json; ext="${atomic} https://example.com/other"` },
        415,
        [atomic]
      ),
      415
    )
  })
})
