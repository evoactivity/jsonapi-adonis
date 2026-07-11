/**
 * Coverage for the less common Lucid relation kinds: hasOne and
 * hasManyThrough. Serialization treats hasOne as to-one and hasManyThrough
 * as to-many; writes through both are rejected.
 */
import { test } from '@japa/runner'
import { DocumentBuilder } from '../../src/document_builder.ts'
import { JsonApiRegistry } from '../../src/registry.ts'
import { LinkBuilder } from '../../src/links.ts'
import { parseQueryParams } from '../../src/params.ts'
import { deserializeResourceDocument } from '../../src/deserializer.ts'
import { JsonApiException } from '../../src/errors.ts'
import { validateIncludeTree } from '../../src/query.ts'
import { Article, Comment, Profile, User, make } from '../fixtures/models.ts'
import { stubRouter } from '../fixtures/stub_router.ts'

function build(input: any, qs: Record<string, unknown> = {}, links = new LinkBuilder(false)) {
  return new DocumentBuilder(new JsonApiRegistry(), parseQueryParams(qs), links).build(input)
}

test.group('hasOne relationships', () => {
  test('preloaded hasOne serializes as to-one linkage', ({ assert }) => {
    const user = make(User, { fullName: 'Alice', email: 'a@x.com' })
    const profile = make(Profile, { bio: 'Hello', userId: user.id })
    user.$setRelated('profile', profile)

    const data = build(user, { include: 'profile' }).data as any
    assert.deepEqual(data.relationships.profile.data, {
      type: 'profiles',
      id: String(profile.id),
    })

    const doc = build(user, { include: 'profile' })
    const included = doc.included as any[]
    assert.equal(included[0].type, 'profiles')
    assert.equal(included[0].attributes.bio, 'Hello')
  })

  test('preloaded-but-absent hasOne serializes as data: null', ({ assert }) => {
    const user = make(User, { fullName: 'Alice', email: 'a@x.com' })
    user.$setRelated('profile', null)
    const data = build(user).data as any
    assert.isNull(data.relationships.profile.data)
  })

  test('unloaded hasOne is omitted (no FK on this side to derive linkage)', ({ assert }) => {
    const user = make(User, { fullName: 'Alice', email: 'a@x.com' })
    const data = build(user).data as any
    assert.notProperty(data.relationships ?? {}, 'profile')
  })

  test('include=profile validates as a supported path', ({ assert }) => {
    assert.doesNotThrow(() => validateIncludeTree(User, { profile: {} }))
  })

  test('writes through hasOne are rejected with 403', ({ assert }) => {
    const error = assert.throws(
      () =>
        deserializeResourceDocument(User, new JsonApiRegistry(), {
          data: {
            type: 'users',
            relationships: { profile: { data: { type: 'profiles', id: '1' } } },
          },
        }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 403)
  })
})

test.group('hasManyThrough relationships', () => {
  test('preloaded hasManyThrough serializes as to-many linkage + included', ({ assert }) => {
    const user = make(User, { fullName: 'Alice', email: 'a@x.com' })
    const article = make(Article, { title: 'T', authorId: user.id })
    const c1 = make(Comment, { body: 'One', articleId: article.id, authorId: 9 })
    const c2 = make(Comment, { body: 'Two', articleId: article.id, authorId: 9 })
    user.$setRelated('receivedComments', [c1, c2])

    const doc = build(user, { include: 'receivedComments' })
    const data = doc.data as any
    assert.deepEqual(data.relationships.receivedComments.data, [
      { type: 'comments', id: String(c1.id) },
      { type: 'comments', id: String(c2.id) },
    ])
    assert.lengthOf(
      (doc.included as any[]).filter((r) => r.type === 'comments'),
      2
    )
  })

  test('include path through the relation validates', ({ assert }) => {
    assert.doesNotThrow(() => validateIncludeTree(User, { receivedComments: { article: {} } }))
  })

  test('writes through hasManyThrough are rejected with 403', ({ assert }) => {
    const error = assert.throws(
      () =>
        deserializeResourceDocument(User, new JsonApiRegistry(), {
          data: {
            type: 'users',
            relationships: { receivedComments: { data: [] } },
          },
        }),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 403)
  })

  test('unloaded hasManyThrough gets links-only treatment when links are on', ({ assert }) => {
    const user = make(User, { fullName: 'Alice', email: 'a@x.com' })
    const data = build(user, {}, new LinkBuilder(true, stubRouter(), 'api.users.show')).data as any
    // relationship member stays camelCase; the URL segment is kebab-cased
    assert.notProperty(data.relationships.receivedComments, 'data')
    assert.equal(
      data.relationships.receivedComments.links.related,
      `/api/users/${user.id}/received-comments`
    )
  })
})
