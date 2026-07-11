/**
 * JSON:API v1.1 spec compliance tests for the plugin prototype, exercised
 * end-to-end through real HTTP endpoints.
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Article from '#models/article'
import Comment from '#models/comment'
import Tag from '#models/tag'

const MEDIA_TYPE = 'application/vnd.api+json'

async function seed() {
  const alice = await User.create({
    fullName: 'Alice Author',
    email: 'alice@example.com',
    password: 'secret123',
  })
  const bob = await User.create({
    fullName: 'Bob Commenter',
    email: 'bob@example.com',
    password: 'secret123',
  })
  const article = await Article.create({
    title: 'JSON:API in AdonisJS',
    body: 'A deep dive.',
    authorId: alice.id,
  })
  await Comment.createMany([
    { body: 'Great post!', articleId: article.id, authorId: bob.id },
    { body: 'Thanks for sharing', articleId: article.id, authorId: alice.id },
  ])
  const tags = await Tag.createMany([{ name: 'adonisjs' }, { name: 'json-api' }])
  await article.related('tags').attach(tags.map((t) => t.id))
  return { alice, bob, article, tags }
}

test.group('JSON:API resource objects', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('single resource: type/id/attributes/links, media type header', async ({
    client,
    assert,
  }) => {
    const { article, alice } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}`)

    response.assertStatus(200)
    assert.equal(response.header('content-type'), MEDIA_TYPE)

    const doc = response.body()
    assert.equal(doc.jsonapi.version, '1.1')
    assert.equal(doc.data.type, 'articles')
    assert.equal(doc.data.id, String(article.id))
    assert.equal(doc.data.attributes.title, 'JSON:API in AdonisJS')

    // id and foreign keys are NOT attributes
    assert.notProperty(doc.data.attributes, 'id')
    assert.notProperty(doc.data.attributes, 'authorId')

    // belongsTo linkage derived from FK without preloading
    assert.deepEqual(doc.data.relationships.author.data, {
      type: 'users',
      id: String(alice.id),
    })

    // relationship + resource links
    assert.equal(doc.data.links.self, `/api/v1/articles/${article.id}`)
    assert.equal(
      doc.data.relationships.author.links.related,
      `/api/v1/articles/${article.id}/author`
    )
    assert.equal(
      doc.data.relationships.author.links.self,
      `/api/v1/articles/${article.id}/relationships/author`
    )

    // no include param → no included member
    assert.notProperty(doc, 'included')
  })

  test('null and empty to-many linkage semantics', async ({ client, assert }) => {
    const { article } = await seed()
    await Comment.query().delete()
    const response = await client.get(`/api/v1/articles/${article.id}?include=comments`)

    response.assertStatus(200)
    const doc = response.body()
    // empty to-many relationship is [] not null
    assert.deepEqual(doc.data.relationships.comments.data, [])
    assert.notProperty(doc, 'included')
  })
})

test.group('JSON:API compound documents (?include=)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('include with nested paths builds deduped included', async ({ client, assert }) => {
    const { article, alice, bob } = await seed()
    const response = await client.get(
      `/api/v1/articles/${article.id}?include=author,comments.author,tags`
    )

    response.assertStatus(200)
    const doc = response.body()

    assert.lengthOf(doc.data.relationships.comments.data, 2)
    assert.lengthOf(doc.data.relationships.tags.data, 2)

    const included = doc.included as any[]
    // full linkage: 2 users + 2 comments + 2 tags = 6, with alice deduped
    // (she is both the article author and a comment author)
    assert.lengthOf(included, 6)
    const users = included.filter((r) => r.type === 'users')
    assert.lengthOf(users, 2)
    assert.sameMembers(
      users.map((r) => r.id),
      [String(alice.id), String(bob.id)]
    )

    // included comments carry their own relationships (full linkage)
    const comment = included.find((r) => r.type === 'comments')
    assert.deepEqual(comment.relationships.author.data.type, 'users')

    // users resource uses the custom UserResource attributes
    const aliceResource = users.find((r) => r.id === String(alice.id))
    assert.deepEqual(Object.keys(aliceResource.attributes).sort(), [
      'email',
      'fullName',
      'initials',
    ])
    assert.equal(aliceResource.attributes.initials, 'AA')
    assert.notProperty(aliceResource.attributes, 'password')
  })

  test('collections dedup included across primary resources', async ({ client, assert }) => {
    const { alice } = await seed()
    await Article.create({ title: 'Second article', body: 'Also by alice', authorId: alice.id })

    const response = await client.get('/api/v1/articles?include=author')
    response.assertStatus(200)
    const doc = response.body()

    assert.lengthOf(doc.data, 2)
    // alice authored both primary resources but appears once
    const users = (doc.included as any[]).filter((r) => r.type === 'users')
    assert.lengthOf(users, 1)
  })

  test('unsupported include path → 400 with source.parameter', async ({ client, assert }) => {
    const { article } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}?include=nonexistent`)

    response.assertStatus(400)
    assert.equal(response.header('content-type'), MEDIA_TYPE)
    const doc = response.body()
    assert.notProperty(doc, 'data')
    assert.equal(doc.errors[0].source.parameter, 'include')
    assert.equal(doc.errors[0].status, '400')
  })

  test('unsupported NESTED include path → 400', async ({ client }) => {
    const { article } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}?include=comments.likes`)
    response.assertStatus(400)
  })
})

test.group('JSON:API sparse fieldsets (?fields[type]=)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('fields restrict attributes and relationships per type', async ({ client, assert }) => {
    const { article } = await seed()
    const response = await client.get(
      `/api/v1/articles/${article.id}?include=author,tags&fields[articles]=title,author&fields[users]=fullName`
    )

    response.assertStatus(200)
    const doc = response.body()

    // articles: only title attribute, only author relationship
    assert.deepEqual(Object.keys(doc.data.attributes), ['title'])
    assert.deepEqual(Object.keys(doc.data.relationships), ['author'])

    // users in included: only fullName
    const user = (doc.included as any[]).find((r) => r.type === 'users')
    assert.deepEqual(Object.keys(user.attributes), ['fullName'])

    // tags relationship was excluded by fields[articles], but tags are NOT
    // in included either since the linkage was removed... actually per spec
    // include and fields are independent: included tags may still appear.
    // We assert the relationship member is gone from the resource object.
    assert.notProperty(doc.data.relationships, 'tags')
  })

  test('empty fieldset removes all attributes', async ({ client, assert }) => {
    const { article } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}?fields[articles]=`)

    response.assertStatus(200)
    const doc = response.body()
    assert.notProperty(doc.data, 'attributes')
    assert.equal(doc.data.type, 'articles')
  })
})

test.group('JSON:API sorting and pagination', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('sort=-title orders descending', async ({ client, assert }) => {
    const { alice } = await seed()
    await Article.create({ title: 'Zebra patterns', body: '...', authorId: alice.id })

    const response = await client.get('/api/v1/articles?sort=-title')
    response.assertStatus(200)
    const titles = (response.body().data as any[]).map((r) => r.attributes.title)
    assert.deepEqual(titles, ['Zebra patterns', 'JSON:API in AdonisJS'])
  })

  test('unknown sort field → 400', async ({ client, assert }) => {
    await seed()
    const response = await client.get('/api/v1/articles?sort=verySecretColumn')
    response.assertStatus(400)
    assert.equal(response.body().errors[0].source.parameter, 'sort')
  })

  test('page[number]/page[size] paginate with spec links', async ({ client, assert }) => {
    const { alice } = await seed()
    for (let i = 2; i <= 5; i++) {
      await Article.create({ title: `Article ${i}`, body: '...', authorId: alice.id })
    }

    const response = await client.get('/api/v1/articles?page[number]=2&page[size]=2&sort=id')
    response.assertStatus(200)
    const doc = response.body()

    assert.lengthOf(doc.data, 2)
    assert.deepEqual(doc.meta.page, { number: 2, size: 2, total: 5, lastPage: 3 })

    // pagination links preserve other query params
    assert.include(doc.links.first, 'page%5Bnumber%5D=1')
    assert.include(doc.links.first, 'sort=id')
    assert.include(doc.links.prev, 'page%5Bnumber%5D=1')
    assert.include(doc.links.next, 'page%5Bnumber%5D=3')
    assert.include(doc.links.last, 'page%5Bnumber%5D=3')
  })

  test('invalid page param → 400', async ({ client }) => {
    await seed()
    const response = await client.get('/api/v1/articles?page[number]=-1')
    response.assertStatus(400)
  })
})

test.group('JSON:API error documents', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('404 renders an errors document with the JSON:API media type', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/api/v1/articles/99999')
    response.assertStatus(404)
    assert.equal(response.header('content-type'), MEDIA_TYPE)

    const doc = response.body()
    assert.isArray(doc.errors)
    assert.equal(doc.errors[0].status, '404')
    assert.equal(doc.errors[0].title, 'Not Found')
    assert.notProperty(doc, 'data')
  })

  test('validation failure renders 422 with source pointers', async ({ client, assert }) => {
    const { alice } = await seed()
    const response = await client.post('/api/v1/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'ab' },
        relationships: { author: { data: { type: 'users', id: String(alice.id) } } },
      },
    })

    response.assertStatus(422)
    assert.equal(response.header('content-type'), MEDIA_TYPE)

    const doc = response.body() as any
    const pointers = doc.errors.map((e: any) => e.source.pointer)
    assert.include(pointers, '/data/attributes/title')
    assert.include(pointers, '/data/attributes/body')
    assert.equal(doc.errors[0].status, '422')
    assert.equal(doc.errors[0].title, 'Validation Failure')
  })

  test('successful create returns 201 with document', async ({ client, assert }) => {
    const { alice } = await seed()
    const response = await client.post('/api/v1/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'A new article', body: 'Hello' },
        relationships: { author: { data: { type: 'users', id: String(alice.id) } } },
      },
    })

    response.assertStatus(201)
    assert.equal((response.body() as any).data.attributes.title, 'A new article')
  })
})

test.group('JSON:API content negotiation', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('Accept with only parameterized JSON:API media types → 406', async ({ client, assert }) => {
    const { article } = await seed()
    const response = await client
      .get(`/api/v1/articles/${article.id}`)
      .header('accept', 'application/vnd.api+json; unsupported=param')

    response.assertStatus(406)
    assert.equal(response.body().errors[0].status, '406')
  })

  test('Accept including a clean JSON:API media type is honoured', async ({ client }) => {
    const { article } = await seed()
    const response = await client
      .get(`/api/v1/articles/${article.id}`)
      .header('accept', 'application/vnd.api+json; unsupported=param, application/vnd.api+json')

    response.assertStatus(200)
  })

  test('Content-Type with media type parameters → 415', async ({ client, assert }) => {
    await seed()
    const response = await client
      .post('/api/v1/articles')
      .json({ data: { type: 'articles', attributes: { title: 'x', body: 'y' } } })
      .header('content-type', 'application/vnd.api+json; unsupported=param')

    response.assertStatus(415)
    assert.equal((response.body() as any).errors[0].status, '415')
  })

  test('ext/profile media type parameters are allowed', async ({ client }) => {
    const { article } = await seed()
    const response = await client
      .get(`/api/v1/articles/${article.id}`)
      .header('accept', 'application/vnd.api+json; profile="https://example.com/last-modified"')

    response.assertStatus(200)
  })
})

test.group('JSON:API zero-config resources', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('unregistered models (Comment, Tag) auto-derive type and attributes', async ({
    client,
    assert,
  }) => {
    const { article } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}?include=comments,tags`)

    response.assertStatus(200)
    const included = response.body().included as any[]

    // Comment has no resource class: type from table name, attributes from
    // columns minus pk/FKs (articleId + authorId excluded as belongsTo FKs)
    const comment = included.find((r) => r.type === 'comments')
    assert.exists(comment)
    assert.property(comment.attributes, 'body')
    assert.notProperty(comment.attributes, 'articleId')
    assert.notProperty(comment.attributes, 'authorId')
    assert.property(comment.relationships, 'article')
    assert.property(comment.relationships, 'author')

    const tag = included.find((r) => r.type === 'tags')
    assert.exists(tag)
    assert.property(tag.attributes, 'name')
  })
})
