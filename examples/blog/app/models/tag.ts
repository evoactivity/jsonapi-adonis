import { TagSchema } from '#database/schema'
import { manyToMany } from '@adonisjs/lucid/orm'
import type { ManyToMany } from '@adonisjs/lucid/types/relations'
import Article from '#models/article'

export default class Tag extends TagSchema {
  @manyToMany(() => Article, { pivotTable: 'article_tags' })
  declare articles: ManyToMany<typeof Article>
}
