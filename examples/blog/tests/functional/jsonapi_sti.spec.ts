/**
 * Single-table inheritance over HTTP (package issue #9). Images and
 * videos share the attachments table; articles hold a mixed to-many of
 * both. Documents must carry concrete types everywhere, writes must
 * accept any family member, and a claimed type that contradicts the
 * row's discriminator must 404 — the identifier names a resource that
 * does not exist.
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Article from '#models/article'
import Attachment from '#models/attachment'

const MEDIA_TYPE = 'application/vnd.api+json'

async function seed() {
  const alice = await User.create({
    fullName: 'Alice Author',
    email: 'alice@example.com',
    password: 'secret123',
  })
  const article = await Article.create({
    title: 'Illustrated article',
    body: 'Body',
    authorId: alice.id,
  })
  const image = await Attachment.create({
    title: 'Diagram',
    kind: 'image',
    url: '/diagram.png',
  })
  const video = await Attachment.create({
    title: 'Walkthrough',
    kind: 'video',
    url: '/walkthrough.mp4',
  })
  return { alice, article, image, video }
}

test.group('STI reads over HTTP', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('included attachments carry concrete types', async ({ client, assert }) => {
    const { article, image, video } = await seed()
    await article.related('attachments').attach([image.id, video.id])

    const response = await client.get(`/api/v1/articles/${article.id}?include=attachments`)
    response.assertStatus(200)
    const doc = response.body() as any

    const linkage = doc.data.relationships.attachments.data
    assert.sameDeepMembers(linkage, [
      { type: 'images', id: String(image.id) },
      { type: 'videos', id: String(video.id) },
    ])
    assert.sameMembers(
      (doc.included as any[]).map((resource) => resource.type),
      ['images', 'videos']
    )
  })

  test('the relationship endpoint serves concrete linkage', async ({ client, assert }) => {
    const { article, image, video } = await seed()
    await article.related('attachments').attach([image.id, video.id])

    const response = await client.get(`/api/v1/articles/${article.id}/relationships/attachments`)
    response.assertStatus(200)
    assert.sameDeepMembers((response.body() as any).data, [
      { type: 'images', id: String(image.id) },
      { type: 'videos', id: String(video.id) },
    ])
  })
})

test.group('STI writes over HTTP', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a mixed family payload attaches through the relationship endpoint', async ({
    client,
    assert,
  }) => {
    const { article, image, video } = await seed()

    const response = await client
      .post(`/api/v1/articles/${article.id}/relationships/attachments`)
      .header('content-type', MEDIA_TYPE)
      .json({
        data: [
          { type: 'images', id: String(image.id) },
          { type: 'videos', id: String(video.id) },
        ],
      })
    response.assertStatus(200)

    await article.load('attachments')
    assert.sameMembers(
      article.attachments.map((attachment) => attachment.id),
      [image.id, video.id]
    )
  })

  test('a type outside the family is a 409', async ({ client, assert }) => {
    const { article, image } = await seed()

    const response = await client
      .post(`/api/v1/articles/${article.id}/relationships/attachments`)
      .header('content-type', MEDIA_TYPE)
      .json({ data: [{ type: 'tags', id: String(image.id) }] })

    response.assertStatus(409)
    const detail = (response.body() as any).errors[0].detail as string
    assert.match(detail, /"images"/)
    assert.match(detail, /"videos"/)
  })

  test('a claimed type contradicting the discriminator is a 404', async ({ client, assert }) => {
    const { article, video } = await seed()

    // video.id exists in the shared table, but as a video: images/<id>
    // names a resource that does not exist
    const response = await client
      .post(`/api/v1/articles/${article.id}/relationships/attachments`)
      .header('content-type', MEDIA_TYPE)
      .json({ data: [{ type: 'images', id: String(video.id) }] })

    response.assertStatus(404)

    await article.load('attachments')
    assert.lengthOf(article.attachments, 0)
  })

  test('a resource create accepts family members in its relationships', async ({
    client,
    assert,
  }) => {
    const { alice, image, video } = await seed()

    const response = await client.post('/api/v1/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'With media', body: '...' },
        relationships: {
          author: { data: { type: 'users', id: String(alice.id) } },
          attachments: {
            data: [
              { type: 'images', id: String(image.id) },
              { type: 'videos', id: String(video.id) },
            ],
          },
        },
      },
    })
    response.assertStatus(201)

    const created = await Article.findOrFail((response.body() as any).data.id)
    await created.load('attachments')
    assert.lengthOf(created.attachments, 2)
  })

  test('a resource create claiming the wrong subtype is a 404', async ({ client }) => {
    const { alice, video } = await seed()

    const response = await client.post('/api/v1/articles').json({
      data: {
        type: 'articles',
        attributes: { title: 'Mislabelled', body: '...' },
        relationships: {
          author: { data: { type: 'users', id: String(alice.id) } },
          attachments: { data: [{ type: 'images', id: String(video.id) }] },
        },
      },
    })
    response.assertStatus(404)
  })
})
