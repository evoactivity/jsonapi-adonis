import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import { filter, applyFilters } from '../../src/filters.ts'
import { JsonApiException } from '../../src/errors.ts'
import { JsonApiResource } from '../../src/resource.ts'
import { Article } from '../fixtures/models.ts'

/**
 * Records where/whereIn calls instead of hitting a database.
 */
function stubQuery() {
  const calls: unknown[][] = []
  const query = {
    calls,
    where(...args: unknown[]) {
      calls.push(['where', ...args])
      return query
    },
    whereIn(...args: unknown[]) {
      calls.push(['whereIn', ...args])
      return query
    },
    whereILike(...args: unknown[]) {
      calls.push(['whereILike', ...args])
      return query
    },
  }
  return query
}

class ArticleResource {
  static filters = {
    title: filter.eq(),
    publishedAfter: filter.gte('createdAt'),
    publishedBefore: filter.lte('createdAt'),
    newerThan: filter.gt('createdAt'),
    olderThan: filter.lt('createdAt'),
    author: filter.relation('author'),
    search: filter.custom((query, value) => {
      void query.whereILike('title', `%${String(value)}%`)
    }),
  }
}

function apply(filters: Record<string, unknown>, ResourceClass: any = ArticleResource) {
  const query = stubQuery()
  applyFilters(
    query as unknown as Parameters<typeof applyFilters>[0],
    Article,
    ResourceClass,
    filters
  )
  return query.calls
}

test.group('filter helpers', () => {
  test('eq: single value → where, comma values → whereIn', ({ assert }) => {
    assert.deepEqual(apply({ title: 'Hello' }), [['where', 'title', 'Hello']])
    assert.deepEqual(apply({ title: ['a', 'b'] }), [['whereIn', 'title', ['a', 'b']]])
    assert.deepEqual(apply({ title: 'a,b' }), [['whereIn', 'title', ['a', 'b']]])
  })

  test('eq: empty value is a no-op', ({ assert }) => {
    assert.deepEqual(apply({ title: '' }), [])
  })

  test('comparison filters map serialized names to columns', ({ assert }) => {
    assert.deepEqual(apply({ publishedAfter: '2026-01-01' }), [
      ['where', 'created_at', '>=', '2026-01-01'],
    ])
    assert.deepEqual(apply({ publishedBefore: '2026-02-01' }), [
      ['where', 'created_at', '<=', '2026-02-01'],
    ])
    assert.deepEqual(apply({ newerThan: '2026-01-01' }), [
      ['where', 'created_at', '>', '2026-01-01'],
    ])
    assert.deepEqual(apply({ olderThan: '2026-01-01' }), [
      ['where', 'created_at', '<', '2026-01-01'],
    ])
  })

  test('comparison filters reject multiple values with a 400', ({ assert }) => {
    const error = assert.throws(
      () => apply({ publishedAfter: 'a,b' }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 400)
    assert.equal(error.errors[0].source?.parameter, 'filter[publishedAfter]')
  })

  test('relation filters by the belongsTo foreign key column', ({ assert }) => {
    assert.deepEqual(apply({ author: '7' }), [['where', 'author_id', '7']])
    assert.deepEqual(apply({ author: '7,9' }), [['whereIn', 'author_id', ['7', '9']]])
  })

  test('relation on a non-belongsTo relation is a developer error', ({ assert }) => {
    class Broken {
      static filters = { comments: filter.relation('comments') }
    }
    assert.throws(() => apply({ comments: '1' }, Broken), /requires a belongsTo relation/)
  })

  test('custom receives the query builder and raw value', ({ assert }) => {
    assert.deepEqual(apply({ search: 'json' }), [['whereILike', 'title', '%json%']])
  })
})

test.group('applyFilters policy', () => {
  test('undeclared filter names → 400 with filter[name] parameter', ({ assert }) => {
    const error = assert.throws(
      () => apply({ nonsense: 'x' }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 400)
    assert.equal(error.errors[0].source?.parameter, 'filter[nonsense]')
  })

  test('resources without declared filters reject all filtering', ({ assert }) => {
    class NoFilters {}
    const error = assert.throws(
      () => apply({ title: 'x' }, NoFilters),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 400)
  })

  test('no filter params means no query changes', ({ assert }) => {
    assert.deepEqual(apply({}), [])
  })
})

test.group('filter handlers receive the request context', () => {
  function capturingResource() {
    const captured: { ctx?: unknown } = {}
    class FilteredResource extends JsonApiResource<Article> {
      static model = () => Article
      static filters = {
        mine: filter.custom((_query, _value, context) => {
          captured.ctx = context.ctx
        }),
      }
    }
    return { FilteredResource, captured }
  }

  test('a custom filter can read the current request', ({ assert }) => {
    const { FilteredResource, captured } = capturingResource()
    const httpContext = new HttpContextFactory().create()

    // the query object is opaque to the handler under test
    applyFilters({} as never, Article, FilteredResource, { mine: '1' }, httpContext)

    assert.strictEqual(captured.ctx, httpContext)
  })

  test('the low-level path outside a request leaves ctx undefined', ({ assert }) => {
    const { FilteredResource, captured } = capturingResource()

    applyFilters({} as never, Article, FilteredResource, { mine: '1' })

    assert.isUndefined(captured.ctx)
  })
})
