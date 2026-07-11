/**
 * Kebab-case policy: auto-derived resource types and URL path segments are
 * kebab-cased; member names inside documents stay camelCase (the official
 * JSON:API recommendation).
 */
import { test } from '@japa/runner'
import { JsonApiRegistry } from '../../src/registry.ts'
import { LinkBuilder } from '../../src/links.ts'
import { getRelationOrFail } from '../../src/relationships.ts'
import { DocumentBuilder } from '../../src/document_builder.ts'
import { parseQueryParams } from '../../src/params.ts'
import { AccessToken, Comment, User, make } from '../fixtures/models.ts'
import { stubRouter } from '../fixtures/stub_router.ts'

test.group('kebab-case types and URLs', () => {
  test('auto-derived types kebab-case the table name', ({ assert }) => {
    const registry = new JsonApiRegistry()
    assert.equal(registry.typeFor(AccessToken), 'access-tokens')
    assert.equal(registry.typeFor(User), 'users')
  })

  test('relationship URL segments are kebab-cased, members stay camelCase', ({ assert }) => {
    const user = make(User, { fullName: 'Alice', email: 'a@x.com' })
    user.$setRelated('receivedComments', [make(Comment, { body: 'x', articleId: 1, authorId: 2 })])
    const doc = new DocumentBuilder(
      new JsonApiRegistry(),
      parseQueryParams({}),
      new LinkBuilder(true, stubRouter(), 'api.users.show')
    ).build(user)
    const data = doc.data as any

    assert.property(data.relationships, 'receivedComments')
    assert.equal(
      data.relationships.receivedComments.links.self,
      `/api/users/${user.id}/relationships/received-comments`
    )
  })

  test('kebab URL segments resolve back to Lucid relation names', ({ assert }) => {
    const relation = getRelationOrFail(User, 'received-comments')
    assert.equal(relation.relationName, 'receivedComments')
    // the Lucid name itself still works too
    assert.equal(getRelationOrFail(User, 'receivedComments').relationName, 'receivedComments')
  })

  test('routes-strategy links pass the kebab segment as the route param', ({ assert }) => {
    const builder = new LinkBuilder(
      true,
      {
        find: () => ({}),
        makeUrl: (_identifier, params: any) => `/v1/users/1/relationships/${params.relation}`,
      },
      'v1.users.show'
    )
    assert.equal(
      builder.relationshipLinks('users', '1', 'receivedComments')?.self,
      '/v1/users/1/relationships/received-comments'
    )
  })
})
