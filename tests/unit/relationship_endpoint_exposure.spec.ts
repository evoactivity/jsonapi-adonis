/**
 * A relation left out of exposeRelationships must be unreachable through the
 * relationship endpoints, not just absent from documents and rejected in
 * ?include=. Serialization and include validation already share the rule via
 * isRelationExposed; these tests pin the endpoints to the same rule.
 *
 * The gate lives in getRelationOrFail, which runs before any database access,
 * so fetchLinkage and updateRelationship can be tested against unsaved rows.
 */
import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import { JsonApiRegistry } from '../../src/registry.ts'
import { JsonApiResource } from '../../src/resource.ts'
import { JsonApiException } from '../../src/errors.ts'
import { JsonApiRequestContext } from '../../src/context.ts'
import { defineConfig } from '../../src/define_config.ts'
import { deserializeResourceDocument } from '../../src/deserializer.ts'
import { fetchLinkage, getRelationOrFail, updateRelationship } from '../../src/relationships.ts'
import { Article, make } from '../fixtures/models.ts'

/**
 * Registry where Article exposes only the named relations, hiding the rest.
 */
function registryHiding(...exposed: string[]) {
  class ArticleResource extends JsonApiResource<Article> {
    static model = () => Article
    static exposeRelationships = exposed
  }
  return new JsonApiRegistry().register([ArticleResource])
}

/**
 * Runs an async call expected to reject and hands back the exception.
 * JsonApiException carries its title as the message, so the detail and status
 * have to be read off the object rather than matched against a message string.
 */
async function rejection(fn: () => Promise<unknown>): Promise<JsonApiException> {
  try {
    await fn()
  } catch (error) {
    return error as JsonApiException
  }
  throw new Error('expected the call to reject, it resolved')
}

test.group('getRelationOrFail and exposeRelationships', () => {
  test('a relation left out of exposeRelationships is a 404', ({ assert }) => {
    const registry = registryHiding('tags')

    const error = assert.throws(
      () => getRelationOrFail(Article, 'author', registry),
      JsonApiException
    ) as unknown as JsonApiException

    assert.equal(error.status, 404)
    assert.match(error.errors[0].detail!, /"author" is not a relationship of Article/)
  })

  test('an unexposed relation is indistinguishable from one that does not exist', ({ assert }) => {
    const registry = registryHiding('tags')

    const hidden = assert.throws(
      () => getRelationOrFail(Article, 'author', registry),
      JsonApiException
    ) as unknown as JsonApiException
    const unknown = assert.throws(
      () => getRelationOrFail(Article, 'nonsense', registry),
      JsonApiException
    ) as unknown as JsonApiException

    assert.equal(hidden.status, unknown.status)
    assert.equal(hidden.errors[0].title, unknown.errors[0].title)
  })

  test('an exposed relation is returned', ({ assert }) => {
    const registry = registryHiding('tags')
    const relation = getRelationOrFail(Article, 'tags', registry)
    assert.equal(relation.relationName, 'tags')
  })

  test('every relation stays reachable when the resource sets no exposeRelationships', ({
    assert,
  }) => {
    class ArticleResource extends JsonApiResource<Article> {
      static model = () => Article
    }
    const registry = new JsonApiRegistry().register([ArticleResource])

    for (const name of ['author', 'comments', 'tags']) {
      assert.equal(getRelationOrFail(Article, name, registry).relationName, name)
    }
  })

  test('an unregistered model keeps every relation reachable', ({ assert }) => {
    const registry = new JsonApiRegistry()
    assert.equal(getRelationOrFail(Article, 'author', registry).relationName, 'author')
  })

  test('an unknown relation is still a 404', ({ assert }) => {
    const registry = registryHiding('tags')
    const error = assert.throws(
      () => getRelationOrFail(Article, 'nonsense', registry),
      JsonApiException
    ) as unknown as JsonApiException
    assert.equal(error.status, 404)
  })
})

test.group('relationship endpoints honour exposeRelationships', () => {
  test('GET /:id/relationships/:name rejects an unexposed relation', async ({ assert }) => {
    const registry = registryHiding('tags')
    const article = make(Article, { title: 'T', authorId: 7 })

    const error = await rejection(() => fetchLinkage(article, 'author', registry))
    assert.equal(error.status, 404)
    assert.match(error.errors[0].detail!, /"author" is not a relationship of Article/)
  })

  test('PATCH /:id/relationships/:name rejects an unexposed to-one relation', async ({
    assert,
  }) => {
    const registry = registryHiding('tags')
    const article = make(Article, { title: 'T', authorId: 7 })

    const error = await rejection(() =>
      updateRelationship(
        article,
        'author',
        registry,
        { data: { type: 'users', id: '1' } },
        'replace'
      )
    )
    assert.equal(error.status, 404)
    assert.match(error.errors[0].detail!, /"author" is not a relationship of Article/)
  })

  test('GET /:id/:name rejects an unexposed relation', async ({ assert }) => {
    const registry = registryHiding('tags')
    const article = make(Article, { title: 'T', authorId: 7 })
    const jsonApi = new JsonApiRequestContext(
      new HttpContextFactory().create(),
      registry,
      defineConfig({})
    )

    const error = await rejection(() => jsonApi.renderRelated(article, 'author'))
    assert.equal(error.status, 404)
    assert.match(error.errors[0].detail!, /"author" is not a relationship of Article/)
  })

  /**
   * tags is a manyToMany, which supports all three write actions, so a
   * rejection here is the exposure gate rather than the 403 hasMany returns
   * for replace and remove.
   */
  for (const action of ['replace', 'add', 'remove'] as const) {
    test(`a ${action} write rejects an unexposed to-many relation`, async ({ assert }) => {
      const registry = registryHiding('author')
      const article = make(Article, { title: 'T', authorId: 7 })

      const error = await rejection(() =>
        updateRelationship(article, 'tags', registry, { data: [] }, action)
      )
      assert.equal(error.status, 404)
      assert.match(error.errors[0].detail!, /"tags" is not a relationship of Article/)
    })
  }
})

test.group('resource write bodies honour exposeRelationships', () => {
  /**
   * The relationships member of a POST or PATCH body is the third write
   * path, alongside the relationship endpoints. A hidden relation must be
   * rejected here too, with the same 400 an unknown member gets, so a
   * hidden relation cannot be told apart from one that does not exist.
   */
  test('a hidden relation in a POST body is rejected like an unknown one', ({ assert }) => {
    const registry = registryHiding('tags')

    const error = assert.throws(
      () =>
        deserializeResourceDocument(Article, registry, {
          data: {
            type: 'articles',
            attributes: { title: 'T' },
            relationships: { author: { data: { type: 'users', id: '42' } } },
          },
        }),
      JsonApiException
    ) as unknown as JsonApiException

    assert.equal(error.status, 400)
    assert.match(error.errors[0].detail!, /"author" is not a known relationship of Article/)
  })

  test('a hidden relation and an unknown one are indistinguishable', ({ assert }) => {
    const registry = registryHiding('tags')
    const bodyWith = (name: string) => ({
      data: {
        type: 'articles',
        relationships: { [name]: { data: null } },
      },
    })

    const hidden = assert.throws(
      () => deserializeResourceDocument(Article, registry, bodyWith('author')),
      JsonApiException
    ) as unknown as JsonApiException
    const unknown = assert.throws(
      () => deserializeResourceDocument(Article, registry, bodyWith('nonsense')),
      JsonApiException
    ) as unknown as JsonApiException

    assert.equal(hidden.status, unknown.status)
    assert.equal(hidden.errors[0].title, unknown.errors[0].title)
  })

  test('an exposed relation in a POST body still deserializes', ({ assert }) => {
    const registry = registryHiding('author')

    const result = deserializeResourceDocument(Article, registry, {
      data: {
        type: 'articles',
        attributes: { title: 'T' },
        relationships: { author: { data: { type: 'users', id: '42' } } },
      },
    })
    assert.equal(result.attributes.authorId, '42')
  })

  test('a resource without exposeRelationships accepts every relation member', ({ assert }) => {
    class ArticleResource extends JsonApiResource<Article> {
      static model = () => Article
    }
    const registry = new JsonApiRegistry().register([ArticleResource])

    const result = deserializeResourceDocument(Article, registry, {
      data: {
        type: 'articles',
        relationships: { author: { data: { type: 'users', id: '7' } } },
      },
    })
    assert.equal(result.attributes.authorId, '7')
  })
})
