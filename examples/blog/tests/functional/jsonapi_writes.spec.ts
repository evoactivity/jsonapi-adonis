/**
 * JSON:API write-side compliance tests: creating/updating/deleting resources
 * from JSON:API request documents and relationship endpoints.
 * https://jsonapi.org/format/#crud
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Article from '#models/article'
import Tag from '#models/tag'

const MEDIA_TYPE = 'application/vnd.api+json'

async function seed() {
  const alice = await User.create({
    fullName: 'Alice Author',
    email: 'alice@example.com',
    password: 'secret123',
  })
  const bob = await User.create({
    fullName: 'Bob Author',
    email: 'bob@example.com',
    password: 'secret123',
  })
  const article = await Article.create({
    title: 'Existing article',
    body: 'Existing body',
    authorId: alice.id,
  })
  const tags = await Tag.createMany([{ name: 'adonisjs' }, { name: 'json-api' }, { name: 'orm' }])
  await article.related('tags').attach([tags[0].id])
  return { alice, bob, article, tags }
}

test.group('JSON:API creating resources', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('create from a full resource document (attributes + to-one + to-many)', async ({
    client,
    assert,
  }) => {
    const { alice, tags } = await seed()
    const response = await client.post('/api/v1/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'Created via JSON:API', body: 'Document body' },
        relationships: {
          author: { data: { type: 'users', id: String(alice.id) } },
          tags: {
            data: [
              { type: 'tags', id: String(tags[0].id) },
              { type: 'tags', id: String(tags[1].id) },
            ],
          },
        },
      },
    })

    response.assertStatus(201)
    assert.equal(response.header('content-type'), MEDIA_TYPE)

    const doc = response.body() as any
    assert.equal(doc.data.attributes.title, 'Created via JSON:API')
    assert.deepEqual(doc.data.relationships.author.data, { type: 'users', id: String(alice.id) })

    // 201 responses carry a Location header matching the self link
    assert.equal(response.header('location'), `/api/v1/articles/${doc.data.id}`)
    assert.equal(doc.data.links.self, `/api/v1/articles/${doc.data.id}`)

    // to-many linkage was synced
    const verify = await client.get(`/api/v1/articles/${doc.data.id}?include=tags`)
    assert.lengthOf((verify.body() as any).data.relationships.tags.data, 2)
  })

  test('type not matching the endpoint → 409', async ({ client, assert }) => {
    await seed()
    const response = await client.post('/api/v1/articles').json({
      data: { type: 'users', attributes: { title: 'x', body: 'y' } },
    })
    response.assertStatus(409)
    assert.equal((response.body() as any).errors[0].source.pointer, '/data/type')
  })

  test('client-generated id → 403 by default', async ({ client, assert }) => {
    await seed()
    const response = await client.post('/api/v1/articles').json({
      data: { type: 'articles', id: '999', attributes: { title: 'xxx', body: 'y' } },
    })
    response.assertStatus(403)
    assert.equal((response.body() as any).errors[0].source.pointer, '/data/id')
  })

  test('missing data member → 400', async ({ client }) => {
    await seed()
    const response = await client
      .post('/api/v1/articles')
      .json({ type: 'articles', attributes: {} })
    response.assertStatus(400)
  })

  test('relationship referencing a missing resource → 404', async ({ client, assert }) => {
    const { alice } = await seed()
    const response = await client.post('/api/v1/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'Valid title', body: 'Valid body' },
        relationships: {
          author: { data: { type: 'users', id: String(alice.id) } },
          tags: { data: [{ type: 'tags', id: '424242' }] },
        },
      },
    })
    response.assertStatus(404)
    assert.include((response.body() as any).errors[0].detail, '424242')
  })

  test('relationship linkage of the wrong type → 409', async ({ client }) => {
    const { alice } = await seed()
    const response = await client.post('/api/v1/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'Valid title', body: 'Valid body' },
        relationships: { author: { data: { type: 'tags', id: String(alice.id) } } },
      },
    })
    response.assertStatus(409)
  })

  test('unknown relationship name → 400', async ({ client }) => {
    await seed()
    const response = await client.post('/api/v1/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'Valid title', body: 'Valid body' },
        relationships: { likes: { data: [] } },
      },
    })
    response.assertStatus(400)
  })
})

test.group('JSON:API updating resources', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('PATCH updates attributes and relationships', async ({ client, assert }) => {
    const { article, bob, tags } = await seed()
    const response = await client.patch(`/api/v1/articles/${article.id}`).json({
      data: {
        type: 'articles',
        id: String(article.id),
        attributes: { title: 'Updated title' },
        relationships: {
          author: { data: { type: 'users', id: String(bob.id) } },
          tags: { data: [{ type: 'tags', id: String(tags[2].id) }] },
        },
      },
    })

    response.assertStatus(200)
    const doc = response.body() as any
    assert.equal(doc.data.attributes.title, 'Updated title')
    // untouched attributes preserved
    assert.equal(doc.data.attributes.body, 'Existing body')
    assert.deepEqual(doc.data.relationships.author.data, { type: 'users', id: String(bob.id) })

    // to-many was fully replaced (spec semantics for relationships in PATCH)
    const verify = await client.get(`/api/v1/articles/${article.id}?include=tags`)
    const linkage = (verify.body() as any).data.relationships.tags.data
    assert.deepEqual(linkage, [{ type: 'tags', id: String(tags[2].id) }])
  })

  test('PATCH without id → 400, mismatched id → 409', async ({ client }) => {
    const { article } = await seed()
    const missing = await client
      .patch(`/api/v1/articles/${article.id}`)
      .json({ data: { type: 'articles', attributes: { title: 'New title' } } })
    missing.assertStatus(400)

    const mismatched = await client
      .patch(`/api/v1/articles/${article.id}`)
      .json({ data: { type: 'articles', id: '999', attributes: { title: 'New title' } } })
    mismatched.assertStatus(409)
  })

  test('DELETE → 204 No Content', async ({ client, assert }) => {
    const { article } = await seed()
    const response = await client.delete(`/api/v1/articles/${article.id}`)
    response.assertStatus(204)
    assert.isNull(await Article.find(article.id))
  })
})

test.group('JSON:API relationship endpoints', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET relationships/<to-many> returns linkage with links', async ({ client, assert }) => {
    const { article, tags } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}/relationships/tags`)

    response.assertStatus(200)
    assert.equal(response.header('content-type'), MEDIA_TYPE)
    const doc = response.body() as any
    assert.deepEqual(doc.data, [{ type: 'tags', id: String(tags[0].id) }])
    assert.equal(doc.links.self, `/api/v1/articles/${article.id}/relationships/tags`)
    assert.equal(doc.links.related, `/api/v1/articles/${article.id}/tags`)
  })

  test('GET relationships/<to-one> returns a single identifier', async ({ client, assert }) => {
    const { article, alice } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}/relationships/author`)
    response.assertStatus(200)
    assert.deepEqual((response.body() as any).data, { type: 'users', id: String(alice.id) })
  })

  test('PATCH relationships/<to-many> replaces all members', async ({ client, assert }) => {
    const { article, tags } = await seed()
    const response = await client.patch(`/api/v1/articles/${article.id}/relationships/tags`).json({
      data: [
        { type: 'tags', id: String(tags[1].id) },
        { type: 'tags', id: String(tags[2].id) },
      ],
    })

    response.assertStatus(200)
    const linkage = (response.body() as any).data as any[]
    assert.sameDeepMembers(linkage, [
      { type: 'tags', id: String(tags[1].id) },
      { type: 'tags', id: String(tags[2].id) },
    ])
  })

  test('POST relationships/<to-many> adds without duplicating', async ({ client, assert }) => {
    const { article, tags } = await seed()
    // tags[0] is already attached — posting it again must not duplicate
    const response = await client.post(`/api/v1/articles/${article.id}/relationships/tags`).json({
      data: [
        { type: 'tags', id: String(tags[0].id) },
        { type: 'tags', id: String(tags[1].id) },
      ],
    })

    response.assertStatus(200)
    const linkage = (response.body() as any).data as any[]
    assert.lengthOf(linkage, 2)
    assert.sameDeepMembers(linkage, [
      { type: 'tags', id: String(tags[0].id) },
      { type: 'tags', id: String(tags[1].id) },
    ])
  })

  test('DELETE relationships/<to-many> removes members', async ({ client, assert }) => {
    const { article, tags } = await seed()
    const response = await client
      .delete(`/api/v1/articles/${article.id}/relationships/tags`)
      .json({ data: [{ type: 'tags', id: String(tags[0].id) }] })

    response.assertStatus(200)
    assert.deepEqual((response.body() as any).data, [])
  })

  test('PATCH relationships/<to-one> reassigns', async ({ client, assert }) => {
    const { article, bob } = await seed()
    const response = await client
      .patch(`/api/v1/articles/${article.id}/relationships/author`)
      .json({ data: { type: 'users', id: String(bob.id) } })

    response.assertStatus(200)
    assert.deepEqual((response.body() as any).data, { type: 'users', id: String(bob.id) })
  })

  test('relationship writes referencing missing resources → 404', async ({ client }) => {
    const { article } = await seed()
    const response = await client
      .patch(`/api/v1/articles/${article.id}/relationships/tags`)
      .json({ data: [{ type: 'tags', id: '424242' }] })
    response.assertStatus(404)
  })

  test('unknown relationship in URL → 404', async ({ client }) => {
    const { article } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}/relationships/likes`)
    response.assertStatus(404)
  })

  test('GET related resource endpoints (links.related targets)', async ({ client, assert }) => {
    const { article, alice } = await seed()

    const author = await client.get(`/api/v1/articles/${article.id}/author`)
    author.assertStatus(200)
    const authorDoc = author.body() as any
    assert.equal(authorDoc.data.type, 'users')
    assert.equal(authorDoc.data.id, String(alice.id))
    assert.equal(authorDoc.data.attributes.fullName, 'Alice Author')

    const tags = await client.get(`/api/v1/articles/${article.id}/tags`)
    tags.assertStatus(200)
    const tagsDoc = tags.body() as any
    assert.isArray(tagsDoc.data)
    assert.equal(tagsDoc.data[0].type, 'tags')
  })
})
