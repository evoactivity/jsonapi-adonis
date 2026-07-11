/**
 * Route-registration-driven link generation: URLs are built from the named
 * routes registered via router.jsonApiResource(), namespaced by the route
 * group that served the request. The same resources are mounted under
 * /api/v1 and /api/v2 in start/routes.ts.
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Article from '#models/article'
import Tag from '#models/tag'

async function seed() {
  const alice = await User.create({
    fullName: 'Alice Author',
    email: 'alice@example.com',
    password: 'secret123',
  })
  const article = await Article.create({
    title: 'Versioned links',
    body: 'Body',
    authorId: alice.id,
  })
  const tag = await Tag.create({ name: 'adonisjs' })
  await article.related('tags').attach([tag.id])
  return { alice, article, tag }
}

test.group('JSON:API link generation', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('links follow the route group that served the request', async ({ client, assert }) => {
    const { article } = await seed()

    const v1Response = await client.get(`/api/v1/articles/${article.id}`)
    const v1 = v1Response.body() as any
    assert.equal(v1.data.links.self, `/api/v1/articles/${article.id}`)
    assert.equal(v1.data.relationships.tags.links.related, `/api/v1/articles/${article.id}/tags`)

    const v2Response = await client.get(`/api/v2/articles/${article.id}`)
    const v2 = v2Response.body() as any
    assert.equal(v2.data.links.self, `/api/v2/articles/${article.id}`)
    assert.equal(
      v2.data.relationships.tags.links.self,
      `/api/v2/articles/${article.id}/relationships/tags`
    )
    assert.equal(v2.data.relationships.tags.links.related, `/api/v2/articles/${article.id}/tags`)
  })

  test('201 Location header follows the serving group', async ({ client, assert }) => {
    const { alice } = await seed()
    const response = await client.post('/api/v2/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'Created under v2', body: 'Body' },
        relationships: { author: { data: { type: 'users', id: String(alice.id) } } },
      },
    })

    response.assertStatus(201)
    const doc = response.body() as any
    assert.equal(response.header('location'), `/api/v2/articles/${doc.data.id}`)
    assert.equal(doc.data.links.self, `/api/v2/articles/${doc.data.id}`)
  })

  test('relationship endpoints under v2 emit v2 linkage links', async ({ client, assert }) => {
    const { article } = await seed()
    const response = await client.get(`/api/v2/articles/${article.id}/relationships/tags`)
    response.assertStatus(200)
    const doc = response.body() as any
    assert.equal(doc.links.self, `/api/v2/articles/${article.id}/relationships/tags`)
    assert.equal(doc.links.related, `/api/v2/articles/${article.id}/tags`)
  })

  test('resources without registered routes get no links', async ({ client, assert }) => {
    const { article } = await seed()
    const response = await client.get(`/api/v1/articles/${article.id}?include=author,tags`)

    response.assertStatus(200)
    const included = (response.body() as any).included as any[]
    assert.isNotEmpty(included)
    // users/tags have no routes registered — advertising self/related links
    // would point at 404s, so none are emitted
    for (const resource of included) {
      assert.notProperty(resource, 'links')
      assert.notProperty(resource.relationships ?? {}, 'links')
    }
  })

  test('pagination links stay on the requesting version', async ({ client, assert }) => {
    await seed()
    const response = await client.get('/api/v2/articles?page[number]=1&page[size]=1')
    response.assertStatus(200)
    const doc = response.body() as any
    assert.include(doc.links.first, '/api/v2/articles?')
  })
})
