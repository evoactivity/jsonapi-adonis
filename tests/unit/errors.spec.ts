import { test } from '@japa/runner'
import { Exception } from '@adonisjs/core/exceptions'
import { JsonApiException, toErrorDocument } from '../../src/errors.ts'

test.group('toErrorDocument', () => {
  test('JsonApiException carries its own error objects and status', ({ assert }) => {
    const exception = JsonApiException.invalidQueryParameter('include', 'nope')
    const { status, body } = toErrorDocument(exception, false)

    assert.equal(status, 400)
    assert.equal(body.jsonapi?.version, '1.1')
    assert.deepEqual(body.errors?.[0].source, { parameter: 'include' })
  })

  test('Vine validation errors become 422 with attribute pointers', ({ assert }) => {
    const vineError = Object.assign(new Error('Validation failure'), {
      code: 'E_VALIDATION_ERROR',
      messages: [
        { message: 'The title field must be defined', rule: 'required', field: 'title' },
        { message: 'Nested failure', rule: 'required', field: 'meta.locale' },
      ],
    })
    const { status, body } = toErrorDocument(vineError, false)

    assert.equal(status, 422)
    assert.equal(body.errors?.[0].source?.pointer, '/data/attributes/title')
    assert.equal(body.errors?.[1].source?.pointer, '/data/attributes/meta/locale')
    assert.equal(body.errors?.[0].code, 'required')
  })

  test('http exceptions map status and expose detail below 500', ({ assert }) => {
    const notFound = new Exception('Row not found', { status: 404, code: 'E_ROW_NOT_FOUND' })
    const { status, body } = toErrorDocument(notFound, false)

    assert.equal(status, 404)
    assert.equal(body.errors?.[0].title, 'Not Found')
    assert.equal(body.errors?.[0].detail, 'Row not found')
  })

  test('unexpected errors become opaque 500s unless debugging', ({ assert }) => {
    const { status, body } = toErrorDocument(new Error('secret internals'), false)
    assert.equal(status, 500)
    assert.isUndefined(body.errors?.[0].detail)

    const debug = toErrorDocument(new Error('secret internals'), true)
    assert.equal(debug.body.errors?.[0].detail, 'secret internals')
  })
})
