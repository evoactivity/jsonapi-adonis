import { CommentSchema } from '#database/schema'
import { belongsTo, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Article from '#models/article'

export default class Comment extends CommentSchema {
  /** Only published comments are visible to readers. */
  static published = scope((query) => {
    query.where('published', true)
  })

  @belongsTo(() => Article)
  declare article: BelongsTo<typeof Article>

  @belongsTo(() => User, { foreignKey: 'authorId' })
  declare author: BelongsTo<typeof User>
}
