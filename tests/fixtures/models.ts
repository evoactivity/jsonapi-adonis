/**
 * Database-less Lucid models for unit tests. Lucid's decorators populate all
 * static metadata ($columnsDefinitions, $relationsDefinitions, table name)
 * without a database connection, and instances can be filled and have
 * relations attached via $setRelated — everything the serializer needs.
 */
import { type DateTime } from 'luxon'
import {
  BaseModel,
  column,
  belongsTo,
  hasOne,
  hasMany,
  manyToMany,
  hasManyThrough,
} from '@adonisjs/lucid/orm'
import type {
  BelongsTo,
  HasOne,
  HasMany,
  ManyToMany,
  HasManyThrough,
} from '@adonisjs/lucid/types/relations'

export class Profile extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare bio: string

  @column()
  declare userId: number
}

/** Multi-word table (access_tokens) for type-derivation tests */
export class AccessToken extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string
}

export class User extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare fullName: string

  @column()
  declare email: string

  @column({ serializeAs: null })
  declare password: string

  @hasOne(() => Profile)
  declare profile: HasOne<typeof Profile>

  @hasMany(() => Article, { foreignKey: 'authorId' })
  declare articles: HasMany<typeof Article>

  @hasManyThrough([() => Comment, () => Article], {
    foreignKey: 'authorId',
    throughForeignKey: 'articleId',
  })
  declare receivedComments: HasManyThrough<typeof Comment>
}

export class Tag extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string
}

export class Comment extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare body: string

  @column()
  declare articleId: number

  @column()
  declare authorId: number

  @belongsTo(() => Article)
  declare article: BelongsTo<typeof Article>

  @belongsTo(() => User, { foreignKey: 'authorId' })
  declare author: BelongsTo<typeof User>
}

export class Article extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare authorId: number

  @column.dateTime()
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'authorId' })
  declare author: BelongsTo<typeof User>

  @hasMany(() => Comment)
  declare comments: HasMany<typeof Comment>

  @manyToMany(() => Tag, { pivotTable: 'article_tags' })
  declare tags: ManyToMany<typeof Tag>
}

let ids = 0

/**
 * Creates a model instance with attributes assigned through Lucid's column
 * setters (so serializeAttributes() sees them).
 */
export function make<T extends typeof BaseModel>(
  Model: T,
  attributes: Record<string, unknown>
): InstanceType<T> {
  const row = new Model() as any
  if (!('id' in attributes)) {
    row.id = ++ids
  }
  Object.assign(row, attributes)
  return row
}
