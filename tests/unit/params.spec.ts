import { test } from '@japa/runner'
import { parseQueryParams } from '../../src/params.ts'
import { JsonApiException } from '../../src/errors.ts'

test.group('parseQueryParams', () => {
  test('parses include paths into a tree', ({ assert }) => {
    const params = parseQueryParams({ include: 'author,comments.author,tags' })
    assert.deepEqual(params.include, { author: {}, comments: { author: {} }, tags: {} })
  })

  test('handles comma-split arrays from the AdonisJS query parser', ({ assert }) => {
    // ?include=a,b arrives as ['a', 'b'] through ctx.request.qs()
    const params = parseQueryParams({ include: ['author', 'comments.author'] })
    assert.deepEqual(params.include, { author: {}, comments: { author: {} } })
  })

  test('parses sparse fieldsets per type', ({ assert }) => {
    const params = parseQueryParams({ fields: { articles: 'title,body', users: 'fullName' } })
    assert.deepEqual(params.fields, { articles: ['title', 'body'], users: ['fullName'] })
  })

  test('empty fieldset means "no fields"', ({ assert }) => {
    const params = parseQueryParams({ fields: { articles: '' } })
    assert.deepEqual(params.fields, { articles: [] })
  })

  test('parses sort with descending prefix', ({ assert }) => {
    const params = parseQueryParams({ sort: '-createdAt,title' })
    assert.deepEqual(params.sort, [
      { field: 'createdAt', direction: 'desc' },
      { field: 'title', direction: 'asc' },
    ])
  })

  test('parses page[number] and page[size]', ({ assert }) => {
    const params = parseQueryParams({ page: { number: '2', size: '10' } })
    assert.deepEqual(params.page, { number: 2, size: 10 })
  })

  test('rejects malformed include paths with a 400', ({ assert }) => {
    const error = assert.throws(
      () => parseQueryParams({ include: 'comments..author' }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 400)
    assert.equal(error.errors[0].source?.parameter, 'include')
  })

  test('rejects non-integer page params with a 400', ({ assert }) => {
    const error = assert.throws(
      () => parseQueryParams({ page: { number: '-1' } }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 400)
    assert.equal(error.errors[0].source?.parameter, 'page[number]')
  })

  test('ignores absent parameters', ({ assert }) => {
    const params = parseQueryParams({})
    assert.deepEqual(params.include, {})
    assert.deepEqual(params.fields, {})
    assert.deepEqual(params.sort, [])
    assert.isNull(params.page)
    assert.deepEqual(params.filter, {})
  })

  test('unknown lowercase parameters → 400 per spec naming rules', ({ assert }) => {
    // https://jsonapi.org/format/#query-parameters — simple lowercase names
    // are reserved by the spec; unknown ones MUST be a 400
    const error = assert.throws(
      () => parseQueryParams({ nonsense: '1' }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 400)
    assert.equal(error.errors[0].source?.parameter, 'nonsense')
  })

  test('implementation-specific parameter names are ignored', ({ assert }) => {
    // At least one non a-z character marks a parameter as belonging to the
    // application, not the spec — we leave those alone
    assert.doesNotThrow(() => parseQueryParams({ cacheBust: '1' }))
    assert.doesNotThrow(() => parseQueryParams({ api_key: 'x' }))
    assert.doesNotThrow(() => parseQueryParams({ 'x-trace': 'y' }))
  })
})
