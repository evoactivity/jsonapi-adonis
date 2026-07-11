import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import User from '#models/user'
import Article from '#models/article'
import Comment from '#models/comment'
import Tag from '#models/tag'

/**
 * Demo data shaped so every ?filter[...] declared on ArticleResource
 * visibly changes the result set — different authors, spread-out
 * publication dates, and distinct title/body keywords.
 */
export default class extends BaseSeeder {
  async run() {
    await Comment.query().delete()
    await Article.query().delete()
    await Tag.query().delete()
    await User.query().delete()

    const [alice, bob] = await User.createMany([
      { fullName: 'Alice Author', email: 'alice@example.com', password: 'secret123' },
      { fullName: 'Bob Blogger', email: 'bob@example.com', password: 'secret123' },
    ])

    const [adonisjs, jsonapi, orm] = await Tag.createMany([
      { name: 'adonisjs' },
      { name: 'json-api' },
      { name: 'orm' },
    ])

    const [intro, lucid, testing] = await Article.createMany([
      {
        title: 'Intro to JSON:API',
        body: 'Why standard response shapes beat bespoke ones.',
        authorId: alice.id,
        createdAt: DateTime.fromISO('2026-01-15T09:00:00Z'),
      },
      {
        title: 'Advanced Lucid patterns',
        body: 'Scopes, hooks and ORM internals.',
        authorId: alice.id,
        createdAt: DateTime.fromISO('2026-03-10T09:00:00Z'),
      },
      {
        title: 'Testing AdonisJS apps',
        body: 'Japa, fixtures and json assertions.',
        authorId: bob.id,
        createdAt: DateTime.fromISO('2026-06-01T09:00:00Z'),
      },
    ])

    await intro.related('tags').attach([adonisjs.id, jsonapi.id])
    await lucid.related('tags').attach([orm.id])
    await testing.related('tags').attach([adonisjs.id])

    await Comment.createMany([
      { body: 'Great overview!', articleId: intro.id, authorId: bob.id },
      { body: 'Bookmarked.', articleId: intro.id, authorId: alice.id },
      { body: 'The scopes section is gold.', articleId: lucid.id, authorId: bob.id },
    ])
  }
}
