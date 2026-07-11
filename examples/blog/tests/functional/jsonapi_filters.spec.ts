/**
 * ?filter[...] behavior: only filters declared on the resource class are
 * accepted; everything else is a 400 (the spec leaves filtering semantics
 * to the server).
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Article from '#models/article'

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
  await Article.createMany([
    { title: 'Intro to JSON:API', body: 'Standards are nice', authorId: alice.id },
    { title: 'Advanced Lucid', body: 'ORM internals', authorId: alice.id },
    { title: 'Testing AdonisJS', body: 'Japa and json fixtures', authorId: bob.id },
  ])
  return { alice, bob }
}

function titles(body: any): string[] {
  return (body.data as any[]).map((r) => r.attributes.title)
}

test.group('JSON:API filtering', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('filter.eq matches a single value', async ({ client, assert }) => {
    await seed()
    const response = await client.get('/api/v1/articles?filter[title]=Advanced Lucid')
    response.assertStatus(200)
    assert.deepEqual(titles(response.body()), ['Advanced Lucid'])
  })

  test('filter.eq with comma-separated values becomes whereIn', async ({ client, assert }) => {
    await seed()
    const response = await client.get(
      '/api/v1/articles?filter[title]=Advanced Lucid,Testing AdonisJS&sort=id'
    )
    response.assertStatus(200)
    assert.deepEqual(titles(response.body()), ['Advanced Lucid', 'Testing AdonisJS'])
  })

  test('filter.relation matches by belongsTo id', async ({ client, assert }) => {
    const { bob } = await seed()
    const response = await client.get(`/api/v1/articles?filter[author]=${bob.id}`)
    response.assertStatus(200)
    assert.deepEqual(titles(response.body()), ['Testing AdonisJS'])
  })

  test('filter.custom runs arbitrary query logic', async ({ client, assert }) => {
    await seed()
    // matches "JSON:API" in one title and "json fixtures" in another body
    const response = await client.get('/api/v1/articles?filter[search]=json&sort=id')
    response.assertStatus(200)
    assert.deepEqual(titles(response.body()), ['Intro to JSON:API', 'Testing AdonisJS'])
  })

  test('filters compose with each other and with pagination', async ({ client, assert }) => {
    const { alice } = await seed()
    const response = await client.get(
      `/api/v1/articles?filter[author]=${alice.id}&filter[search]=lucid&page[size]=10`
    )
    response.assertStatus(200)
    assert.deepEqual(titles(response.body()), ['Advanced Lucid'])
  })

  test('undeclared filters → 400 with source.parameter', async ({ client, assert }) => {
    await seed()
    const response = await client.get('/api/v1/articles?filter[secretColumn]=x')
    response.assertStatus(400)
    const doc = response.body() as any
    assert.equal(doc.errors[0].source.parameter, 'filter[secretColumn]')
  })
})
