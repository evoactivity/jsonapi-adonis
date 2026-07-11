import { test } from '@japa/runner'
import { deserializeResourceDocument } from '../../src/deserializer.ts'
import { JsonApiRegistry } from '../../src/registry.ts'
import { JsonApiException } from '../../src/errors.ts'
import { Article } from '../fixtures/models.ts'

const registry = new JsonApiRegistry()

function deserialize(
  body: unknown,
  options: { expectedId?: string; allowClientIds?: boolean } = {}
) {
  return deserializeResourceDocument(Article, registry, body, options)
}

function catchException(fn: () => unknown): JsonApiException {
  try {
    fn()
  } catch (error) {
    if (error instanceof JsonApiException) return error
    throw error
  }
  throw new Error('Expected a JsonApiException to be thrown')
}

test.group('deserializeResourceDocument: structure', () => {
  test('maps attributes and to-one relationships to model shapes', ({ assert }) => {
    const result = deserialize({
      data: {
        type: 'articles',
        attributes: { title: 'Hello' },
        relationships: {
          author: { data: { type: 'users', id: '7' } },
          tags: {
            data: [
              { type: 'tags', id: '1' },
              { type: 'tags', id: '2' },
            ],
          },
        },
      },
    })

    assert.deepEqual(result.attributes, { title: 'Hello', authorId: '7' })
    assert.deepEqual(result.toMany, { tags: ['1', '2'] })
    assert.deepEqual(result.references, [
      { relation: 'author', ids: ['7'] },
      { relation: 'tags', ids: ['1', '2'] },
    ])
  })

  test('a null to-one linkage clears the foreign key', ({ assert }) => {
    const result = deserialize({
      data: { type: 'articles', relationships: { author: { data: null } } },
    })
    assert.deepEqual(result.attributes, { authorId: null })
  })

  test('unknown attributes are dropped, known ones mapped by serialized name', ({ assert }) => {
    const result = deserialize({
      data: { type: 'articles', attributes: { title: 'x', nonsense: true } },
    })
    assert.deepEqual(result.attributes, { title: 'x' })
  })
})

test.group('deserializeResourceDocument: error semantics', () => {
  test('missing data member → 400', ({ assert }) => {
    const error = catchException(() => deserialize({ type: 'articles' }))
    assert.equal(error.status, 400)
  })

  test('type mismatch → 409 with pointer /data/type', ({ assert }) => {
    const error = catchException(() => deserialize({ data: { type: 'users' } }))
    assert.equal(error.status, 409)
    assert.equal(error.errors[0].source?.pointer, '/data/type')
  })

  test('client-generated id → 403 unless allowed', ({ assert }) => {
    const body = { data: { type: 'articles', id: '5' } }
    const error = catchException(() => deserialize(body))
    assert.equal(error.status, 403)

    const allowed = deserialize(body, { allowClientIds: true })
    assert.equal(allowed.id, '5')
  })

  test('update without id → 400, with mismatched id → 409', ({ assert }) => {
    const missing = catchException(() =>
      deserialize({ data: { type: 'articles' } }, { expectedId: '1' })
    )
    assert.equal(missing.status, 400)

    const mismatched = catchException(() =>
      deserialize({ data: { type: 'articles', id: '2' } }, { expectedId: '1' })
    )
    assert.equal(mismatched.status, 409)
    assert.equal(mismatched.errors[0].source?.pointer, '/data/id')
  })

  test('id/type inside attributes → 400', ({ assert }) => {
    const error = catchException(() =>
      deserialize({ data: { type: 'articles', attributes: { id: 1 } } })
    )
    assert.equal(error.status, 400)
  })

  test('unknown relationship → 400 with pointer', ({ assert }) => {
    const error = catchException(() =>
      deserialize({ data: { type: 'articles', relationships: { likes: { data: [] } } } })
    )
    assert.equal(error.status, 400)
    assert.equal(error.errors[0].source?.pointer, '/data/relationships/likes')
  })

  test('relationship without data member → 400', ({ assert }) => {
    const error = catchException(() =>
      deserialize({
        data: { type: 'articles', relationships: { author: { links: {} } } },
      })
    )
    assert.equal(error.status, 400)
  })

  test('to-one linkage of the wrong type → 409', ({ assert }) => {
    const error = catchException(() =>
      deserialize({
        data: {
          type: 'articles',
          relationships: { author: { data: { type: 'tags', id: '1' } } },
        },
      })
    )
    assert.equal(error.status, 409)
  })

  test('to-many linkage must be an array → 400', ({ assert }) => {
    const error = catchException(() =>
      deserialize({
        data: {
          type: 'articles',
          relationships: { tags: { data: { type: 'tags', id: '1' } } },
        },
      })
    )
    assert.equal(error.status, 400)
  })

  test('identifiers must have string type and id → 400', ({ assert }) => {
    const error = catchException(() =>
      deserialize({
        data: {
          type: 'articles',
          relationships: { tags: { data: [{ type: 'tags', id: 1 }] } },
        },
      })
    )
    assert.equal(error.status, 400)
  })
})
