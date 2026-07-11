/**
 * Pins every customization point on JsonApiResource. The "Customizing a
 * resource" section of docs/reading-data.md is written against these tests;
 * if a claim there stops being true, something here should fail.
 */
import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import { DocumentBuilder } from '../../src/document_builder.ts'
import { JsonApiRegistry } from '../../src/registry.ts'
import { JsonApiResource } from '../../src/resource.ts'
import { LinkBuilder } from '../../src/links.ts'
import { parseQueryParams } from '../../src/params.ts'
import { Article, User, make } from '../fixtures/models.ts'
import { stubRouter } from '../fixtures/stub_router.ts'

function build(
  input: any,
  registry = new JsonApiRegistry(),
  links: LinkBuilder = new LinkBuilder(false),
  ctx?: any
) {
  return new DocumentBuilder(registry, parseQueryParams({}), links, ctx).build(input)
}

test.group('what is required', () => {
  test('static model is the only required member when registering', ({ assert }) => {
    class Bare extends JsonApiResource<Article> {}
    assert.throws(
      () => new JsonApiRegistry().register([Bare]),
      /must define a static model property/
    )

    class JustModel extends JsonApiResource<Article> {
      static model = () => Article
    }
    assert.doesNotThrow(() => new JsonApiRegistry().register([JustModel]))
  })

  test('every other member has a working default', ({ assert }) => {
    class JustModel extends JsonApiResource<Article> {
      static model = () => Article
    }
    const registry = new JsonApiRegistry().register([JustModel])
    const article = make(Article, { title: 'Hello', authorId: 7 })
    const data = build(article, registry).data as any

    assert.equal(data.type, 'articles')
    assert.equal(data.id, String(article.id))
    assert.equal(data.attributes.title, 'Hello')
    assert.notProperty(data, 'meta')
  })
})

test.group('static type', () => {
  test('defaults to the kebab-cased table name', ({ assert }) => {
    const data = build(make(User, { fullName: 'A', email: 'a@x.com' })).data as any
    assert.equal(data.type, 'users')
  })

  test('static type overrides the default', ({ assert }) => {
    class PersonResource extends JsonApiResource<User> {
      static type = 'people'
      static model = () => User
    }
    const registry = new JsonApiRegistry().register([PersonResource])
    const data = build(make(User, { fullName: 'A', email: 'a@x.com' }), registry).data as any
    assert.equal(data.type, 'people')
  })
})

test.group('id()', () => {
  test('defaults to the primary key as a string', ({ assert }) => {
    const user = make(User, { fullName: 'A', email: 'a@x.com' })
    const data = build(user).data as any
    assert.strictEqual(data.id, String(user.id))
  })

  test('overriding id() changes the resource identity everywhere', ({ assert }) => {
    class UserResource extends JsonApiResource<User> {
      static model = () => User
      id() {
        return `u-${this.resource.id}`
      }
    }
    const registry = new JsonApiRegistry().register([UserResource])

    const author = make(User, { fullName: 'A', email: 'a@x.com' })
    const article = make(Article, { title: 'T', authorId: author.id })
    article.$setRelated('author', author)

    const doc = new DocumentBuilder(
      registry,
      parseQueryParams({ include: 'author' }),
      new LinkBuilder(false)
    ).build(article)
    const data = doc.data as any

    // linkage and included agree on the custom identity
    assert.equal(data.relationships.author.data.id, `u-${author.id}`)
    assert.equal((doc.included as any[])[0].id, `u-${author.id}`)
  })
})

test.group('attributes()', () => {
  test('default excludes the pk, belongsTo FKs and serializeAs: null columns', ({ assert }) => {
    const article = make(Article, { title: 'T', authorId: 7 })
    const articleData = build(article).data as any
    assert.notProperty(articleData.attributes, 'id')
    assert.notProperty(articleData.attributes, 'authorId') // belongsTo FK

    const user = make(User, { fullName: 'A', email: 'a@x.com', password: 'pw' })
    const userData = build(user).data as any
    assert.notProperty(userData.attributes, 'password') // serializeAs: null
  })

  test('override picks fields and adds computed values', ({ assert }) => {
    class UserResource extends JsonApiResource<User> {
      static model = () => User
      attributes() {
        return {
          ...this.pick(['fullName']),
          shout: this.resource.fullName.toUpperCase(),
        }
      }
    }
    const registry = new JsonApiRegistry().register([UserResource])
    const data = build(make(User, { fullName: 'Alice', email: 'a@x.com' }), registry).data as any

    assert.deepEqual(data.attributes, { fullName: 'Alice', shout: 'ALICE' })
  })
})

test.group('links()', () => {
  test('custom links merge with the generated self link', ({ assert }) => {
    class UserResource extends JsonApiResource<User> {
      static model = () => User
      links() {
        return { canonical: `https://example.com/u/${this.resource.id}` }
      }
    }
    const registry = new JsonApiRegistry().register([UserResource])
    const user = make(User, { fullName: 'A', email: 'a@x.com' })
    const data = build(user, registry, new LinkBuilder(true, stubRouter(), 'api.users.show'))
      .data as any

    assert.equal(data.links.self, `/api/users/${user.id}`) // generated
    assert.equal(data.links.canonical, `https://example.com/u/${user.id}`) // custom
  })

  test('a custom self overrides the generated one', ({ assert }) => {
    class UserResource extends JsonApiResource<User> {
      static model = () => User
      links() {
        return { self: 'https://elsewhere.example/me' }
      }
    }
    const registry = new JsonApiRegistry().register([UserResource])
    const data = build(
      make(User, { fullName: 'A', email: 'a@x.com' }),
      registry,
      new LinkBuilder(true, stubRouter(), 'api.users.show')
    ).data as any

    assert.equal(data.links.self, 'https://elsewhere.example/me')
  })
})

test.group('meta()', () => {
  test('returned meta is emitted on the resource object', ({ assert }) => {
    class UserResource extends JsonApiResource<User> {
      static model = () => User
      meta() {
        return { emailDomain: this.resource.email.split('@')[1] }
      }
    }
    const registry = new JsonApiRegistry().register([UserResource])
    const data = build(make(User, { fullName: 'A', email: 'a@x.com' }), registry).data as any
    assert.deepEqual(data.meta, { emailDomain: 'x.com' })
  })

  test('undefined or empty meta is omitted entirely', ({ assert }) => {
    class EmptyMeta extends JsonApiResource<User> {
      static model = () => User
      meta() {
        return {}
      }
    }
    const registry = new JsonApiRegistry().register([EmptyMeta])
    const data = build(make(User, { fullName: 'A', email: 'a@x.com' }), registry).data as any
    assert.notProperty(data, 'meta')
  })
})

test.group('exposeRelationships', () => {
  test('restricts which relations appear as relationship members', ({ assert }) => {
    class ArticleResource extends JsonApiResource<Article> {
      static model = () => Article
      static exposeRelationships = ['author']
    }
    const registry = new JsonApiRegistry().register([ArticleResource])
    const article = make(Article, { title: 'T', authorId: 7 })
    const data = build(article, registry).data as any

    assert.property(data.relationships, 'author')
    assert.notProperty(data.relationships ?? {}, 'comments')
    assert.notProperty(data.relationships ?? {}, 'tags')
  })
})

test.group('this.ctx', () => {
  test('the HttpContext reaches the resource during request serialization', ({ assert }) => {
    class UserResource extends JsonApiResource<User> {
      static model = () => User
      meta() {
        return { hasContext: this.ctx !== undefined }
      }
    }
    const registry = new JsonApiRegistry().register([UserResource])
    const user = make(User, { fullName: 'A', email: 'a@x.com' })

    const withCtx = build(user, registry, new LinkBuilder(false), new HttpContextFactory().create())
    assert.deepEqual((withCtx.data as any).meta, { hasContext: true })

    const withoutCtx = build(user, registry)
    assert.deepEqual((withoutCtx.data as any).meta, { hasContext: false })
  })
})

test.group('exposeRelationships and ?include=', () => {
  test('a hidden relation is still accepted by include but contributes nothing', ({ assert }) => {
    class ArticleResource extends JsonApiResource<Article> {
      static model = () => Article
      static exposeRelationships = ['tags']
    }
    const registry = new JsonApiRegistry().register([ArticleResource])

    const author = make(User, { fullName: 'A', email: 'a@x.com' })
    const article = make(Article, { title: 'T', authorId: author.id })
    article.$setRelated('author', author)

    // include validation only consults the model's relations, not the
    // resource's exposeRelationships list, so this does not 400 today
    const doc = new DocumentBuilder(
      registry,
      parseQueryParams({ include: 'author' }),
      new LinkBuilder(false)
    ).build(article)

    const data = doc.data as any
    assert.notProperty(data.relationships ?? {}, 'author')
    assert.notProperty(doc, 'included')
  })
})
