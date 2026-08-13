import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'attachments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('title').notNullable()
      // Discriminator for the single-table inheritance family
      table.string('kind').notNullable()
      table.string('url').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('article_attachments', (table) => {
      table.increments('id').notNullable()
      table
        .integer('article_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('articles')
        .onDelete('CASCADE')
      table
        .integer('attachment_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('attachments')
        .onDelete('CASCADE')
      table.unique(['article_id', 'attachment_id'])

      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('article_attachments')
    this.schema.dropTable(this.tableName)
  }
}
