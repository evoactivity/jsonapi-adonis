import { AttachmentSchema } from '#database/schema'
import { beforeCreate } from '@adonisjs/lucid/orm'
import type { LucidModel, ModelAdapterOptions } from '@adonisjs/lucid/types/model'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'

/**
 * The base of a single-table inheritance family. Images and videos share
 * the attachments table, told apart by the kind column. Application code
 * uses the subclasses; relations that can hold either target this base,
 * which stays unscoped so it sees the whole family.
 */
export default class Attachment extends AttachmentSchema {
  /** The discriminator value each subclass owns; null on the base. */
  static readonly attachmentKind: 'image' | 'video' | null = null

  /**
   * Scopes subclass queries to their discriminator, so Image.query()
   * only ever sees image rows. find/findOrFail/first inherit the scope
   * because they build on query().
   */
  static query<Model extends LucidModel, Result = InstanceType<Model>>(
    this: Model,
    options?: ModelAdapterOptions
  ): ModelQueryBuilderContract<Model, Result> {
    const query = super.query(options) as unknown as ModelQueryBuilderContract<Model, Result>
    const kind = (this as unknown as typeof Attachment).attachmentKind
    if (kind) query.where('kind', kind)
    return query
  }

  /** Rows created through a subclass carry its discriminator. */
  @beforeCreate()
  static assignKind(row: Attachment) {
    const kind = (row.constructor as typeof Attachment).attachmentKind
    if (kind && !row.kind) row.kind = kind
  }
}

export class Image extends Attachment {
  static table = 'attachments'
  static readonly attachmentKind = 'image' as const
}

export class Video extends Attachment {
  static table = 'attachments'
  static readonly attachmentKind = 'video' as const
}
