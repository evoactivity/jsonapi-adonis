/**
 * End-to-end proof that withPreloadScopes constrains an included relation
 * through a real HTTP request, real Lucid query builder, and real SQL: the
 * macro registers, the chain keeps one builder instance, and the scope is
 * read when the preload runs.
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Article from '#models/article'
import Comment from '#models/comment'

interface Resource {
  type: string
  attributes: { body: string }
}

async function seed() {
  const author = await User.create({
    fullName: 'Ann Author',
    email: 'ann@example.com',
    password: 'secret123',
  })
  const article = await Article.create({
    title: 'Scoped includes',
    body: 'A body.',
    authorId: author.id,
  })
  await Comment.createMany([
    { body: 'Visible', articleId: article.id, authorId: author.id, published: true },
    { body: 'Hidden', articleId: article.id, authorId: author.id, published: false },
  ])
  return { article }
}

function comments(body: { included?: Resource[] }): Resource[] {
  return (body.included ?? []).filter((resource) => resource.type === 'comments')
}

test.group('withPreloadScopes end to end', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('constrains an included relation to a model scope', async ({ client, assert }) => {
    const { article } = await seed()

    const response = await client.get(`/api/v1/scoped-articles/${article.id}?include=comments`)

    response.assertStatus(200)
    const included = comments(response.body())
    assert.lengthOf(included, 1)
    assert.equal(included[0].attributes.body, 'Visible')
  })

  test('the same include is unfiltered without a preload scope', async ({ client, assert }) => {
    const { article } = await seed()

    const response = await client.get(`/api/v1/articles/${article.id}?include=comments`)

    response.assertStatus(200)
    // proves the scope, not empty data, is what filtered the scoped endpoint
    assert.lengthOf(comments(response.body()), 2)
  })
})
