import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { DocumentBuilder } from '../../src/document_builder.ts'
import { JsonApiRegistry } from '../../src/registry.ts'
import { JsonApiResource } from '../../src/resource.ts'
import { LinkBuilder } from '../../src/links.ts'
import { parseQueryParams } from '../../src/params.ts'
import { Article, Comment, Tag, User, make } from '../fixtures/models.ts'
import { stubRouter } from '../fixtures/stub_router.ts'

function build(
  input: any,
  qs: Record<string, unknown> = {},
  registry = new JsonApiRegistry(),
  links: LinkBuilder = new LinkBuilder(false)
) {
  return new DocumentBuilder(registry, parseQueryParams(qs), links).build(input)
}

function sampleGraph() {
  const alice = make(User, { fullName: 'Alice', email: 'alice@x.com' })
  const bob = make(User, { fullName: 'Bob', email: 'bob@x.com' })
  const article = make(Article, {
    title: 'Hello',
    authorId: alice.id,
    createdAt: DateTime.fromISO('2026-01-01T00:00:00Z'),
  })
  const c1 = make(Comment, { body: 'First', articleId: article.id, authorId: bob.id })
  const c2 = make(Comment, { body: 'Second', articleId: article.id, authorId: alice.id })
  c1.$setRelated('author', bob)
  c2.$setRelated('author', alice)
  article.$setRelated('author', alice)
  article.$setRelated('comments', [c1, c2])
  return { alice, bob, article, c1, c2 }
}

test.group('DocumentBuilder: resource objects', () => {
  test('serializes type, string id and attributes without pk/FKs', ({ assert }) => {
    const article = make(Article, { title: 'Hello', authorId: 7 })
    const doc = build(article)
    const data = doc.data as any

    assert.equal(data.type, 'articles')
    assert.equal(data.id, String(article.id))
    assert.equal(data.attributes.title, 'Hello')
    assert.notProperty(data.attributes, 'id')
    assert.notProperty(data.attributes, 'authorId')
    assert.equal(doc.jsonapi?.version, '1.1')
  })

  test('serializeAs: null columns never appear', ({ assert }) => {
    const user = make(User, { fullName: 'A', email: 'a@x.com', password: 'secret' })
    const data = build(user).data as any
    assert.equal(data.type, 'users')
    assert.notProperty(data.attributes, 'password')
  })

  test('belongsTo linkage is derived from the FK without preloading', ({ assert }) => {
    const article = make(Article, { title: 'Hello', authorId: 42 })
    const data = build(article).data as any
    assert.deepEqual(data.relationships.author.data, { type: 'users', id: '42' })
  })

  test('unloaded to-many relations are omitted when links are off', ({ assert }) => {
    const article = make(Article, { title: 'Hello', authorId: 1 })
    const data = build(article).data as any
    assert.notProperty(data.relationships, 'comments')
    assert.notProperty(data.relationships, 'tags')
  })

  test('null primary data', ({ assert }) => {
    const doc = build(null)
    assert.isNull(doc.data)
  })
})

test.group('DocumentBuilder: compound documents', () => {
  test('included follows the include tree and dedups by (type, id)', ({ assert }) => {
    const { article, alice, bob } = sampleGraph()
    const doc = build(article, { include: 'author,comments.author' })

    const included = doc.included as any[]
    const users = included.filter((r) => r.type === 'users')
    // alice reachable both as article author and comment author → once
    assert.lengthOf(users, 2)
    assert.sameMembers(
      users.map((r) => r.id),
      [String(alice.id), String(bob.id)]
    )
    assert.lengthOf(
      included.filter((r) => r.type === 'comments'),
      2
    )
  })

  test('preloaded but not included relations contribute linkage only', ({ assert }) => {
    const { article } = sampleGraph()
    const doc = build(article, {})
    const data = doc.data as any

    assert.lengthOf(data.relationships.comments.data, 2)
    assert.notProperty(doc, 'included')
  })

  test('empty to-many preload serializes as data: []', ({ assert }) => {
    const article = make(Article, { title: 'Hello', authorId: 1 })
    article.$setRelated('comments', [])
    const data = build(article).data as any
    assert.deepEqual(data.relationships.comments.data, [])
  })

  test('primary resources are never duplicated into included', ({ assert }) => {
    const { article, c1 } = sampleGraph()
    c1.$setRelated('article', article)
    const doc = build(article, { include: 'comments.article' })
    const includedArticles = (doc.included as any[]).filter((r) => r.type === 'articles')
    assert.lengthOf(includedArticles, 0)
  })
})

test.group('DocumentBuilder: sparse fieldsets', () => {
  test('fields[type] restricts attributes and relationships', ({ assert }) => {
    const { article } = sampleGraph()
    const doc = build(article, {
      include: 'author',
      fields: { articles: 'title,author', users: 'fullName' },
    })
    const data = doc.data as any

    assert.deepEqual(Object.keys(data.attributes), ['title'])
    assert.deepEqual(Object.keys(data.relationships), ['author'])
    const user = (doc.included as any[]).find((r) => r.type === 'users')
    assert.deepEqual(Object.keys(user.attributes), ['fullName'])
  })

  test('empty fieldset removes the attributes member entirely', ({ assert }) => {
    const article = make(Article, { title: 'Hello', authorId: 1 })
    const doc = build(article, { fields: { articles: '' } })
    assert.notProperty(doc.data, 'attributes')
  })
})

test.group('DocumentBuilder: links and custom resources', () => {
  test('resource and relationship links come from the LinkBuilder', ({ assert }) => {
    const article = make(Article, { title: 'Hello', authorId: 1 })
    const doc = build(
      article,
      {},
      new JsonApiRegistry(),
      new LinkBuilder(true, stubRouter(), 'api.articles.show')
    )
    const data = doc.data as any

    assert.equal(data.links.self, `/api/articles/${article.id}`)
    assert.equal(data.relationships.comments.links.related, `/api/articles/${article.id}/comments`)
    // unloaded to-many now appears, links-only — no false data member
    assert.notProperty(data.relationships.comments, 'data')
  })

  test('a registered resource class overrides type and attributes', ({ assert }) => {
    class UserResource extends JsonApiResource<User> {
      static type = 'people'
      static model = () => User
      attributes() {
        return this.pick(['fullName'])
      }
    }
    const registry = new JsonApiRegistry().register([UserResource])
    const user = make(User, { fullName: 'Alice', email: 'alice@x.com' })
    const data = build(user, {}, registry).data as any

    assert.equal(data.type, 'people')
    assert.deepEqual(Object.keys(data.attributes), ['fullName'])
  })

  test('exposeRelationships restricts relationship members', ({ assert }) => {
    class ArticleResource extends JsonApiResource<Article> {
      static type = 'articles'
      static model = () => Article
      static exposeRelationships = ['author']
    }
    const registry = new JsonApiRegistry().register([ArticleResource])
    const { article } = sampleGraph()
    const data = build(article, {}, registry).data as any

    assert.deepEqual(Object.keys(data.relationships), ['author'])
  })

  test('tags relation on unregistered models auto-derives its type', ({ assert }) => {
    const article = make(Article, { title: 'Hello', authorId: 1 })
    article.$setRelated('tags', [make(Tag, { name: 'x' })])
    const data = build(article).data as any
    assert.equal(data.relationships.tags.data[0].type, 'tags')
  })
})
