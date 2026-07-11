import { test } from '@japa/runner'
import { LinkBuilder } from '../../src/links.ts'
import { stubRouter } from '../fixtures/stub_router.ts'

const V1_ROUTES = [
  'v1.articles.show',
  'v1.articles.relationships.show',
  'v1.articles.related',
  'v2.articles.show',
]

test.group('LinkBuilder.namespaceOf', () => {
  test('derives the namespace from resource action route names', ({ assert }) => {
    assert.deepEqual(LinkBuilder.namespaceOf('api.v1.articles.show'), ['api', 'v1'])
    assert.deepEqual(LinkBuilder.namespaceOf('articles.index'), [])
    assert.deepEqual(LinkBuilder.namespaceOf('v2.articles.related'), ['v2'])
  })

  test('derives the namespace from relationship route names', ({ assert }) => {
    assert.deepEqual(LinkBuilder.namespaceOf('api.v1.articles.relationships.replace'), [
      'api',
      'v1',
    ])
  })

  test('returns null for names outside the convention', ({ assert }) => {
    assert.isNull(LinkBuilder.namespaceOf('login'))
    assert.isNull(LinkBuilder.namespaceOf('auth.signup'))
  })
})

test.group('LinkBuilder', () => {
  test('builds links inside the namespace of the current route', ({ assert }) => {
    const builder = new LinkBuilder(true, stubRouter(V1_ROUTES), 'v1.articles.show')
    assert.equal(builder.resourceSelf('articles', '1'), '/v1/articles/1')
    assert.deepEqual(builder.relationshipLinks('articles', '1', 'tags'), {
      self: '/v1/articles/1/relationships/tags',
      related: '/v1/articles/1/tags',
    })
  })

  test('a v2 request generates v2 links', ({ assert }) => {
    const builder = new LinkBuilder(true, stubRouter(V1_ROUTES), 'v2.articles.show')
    assert.equal(builder.resourceSelf('articles', '9'), '/v2/articles/9')
  })

  test('omits links for routes that do not exist', ({ assert }) => {
    const builder = new LinkBuilder(true, stubRouter(V1_ROUTES), 'v1.articles.show')
    // users routes are not registered
    assert.isUndefined(builder.resourceSelf('users', '1'))
    assert.isUndefined(builder.relationshipLinks('users', '1', 'articles'))
    // v2 has no relationship routes registered
    const v2 = new LinkBuilder(true, stubRouter(V1_ROUTES), 'v2.articles.show')
    assert.isUndefined(v2.relationshipLinks('articles', '1', 'tags'))
  })

  test('omits links without a current route or router', ({ assert }) => {
    assert.isUndefined(
      new LinkBuilder(true, stubRouter(V1_ROUTES), undefined).resourceSelf('articles', '1')
    )
    assert.isUndefined(
      new LinkBuilder(true, undefined, 'v1.articles.show').resourceSelf('articles', '1')
    )
  })

  test('links: false disables link generation entirely', ({ assert }) => {
    const builder = new LinkBuilder(false, stubRouter(V1_ROUTES), 'v1.articles.show')
    assert.isFalse(builder.enabled)
    assert.isUndefined(builder.resourceSelf('articles', '1'))
    assert.isUndefined(builder.relationshipLinks('articles', '1', 'tags'))
  })
})
