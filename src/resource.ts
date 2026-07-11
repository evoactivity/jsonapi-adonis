import type { HttpContext } from '@adonisjs/core/http'
import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model'
import type { Links, Meta } from './types.ts'
import type { FilterHandler } from './filters.ts'

/**
 * Describes how a Lucid model serializes into a JSON:API resource object.
 *
 * A resource class is optional per model — the registry can auto-derive
 * everything (type name, attributes, relationships) from Lucid metadata.
 * Subclass to customize:
 *
 * ```ts
 * export default class ArticleResource extends JsonApiResource<Article> {
 *   static type = 'articles'
 *   static model = () => Article
 *
 *   attributes() {
 *     return this.pick(['title', 'body', 'createdAt'])
 *   }
 * }
 * ```
 */
export class JsonApiResource<Row extends LucidRow = LucidRow> {
  /**
   * The JSON:API resource type. Defaults to the camelCased table name of
   * the model.
   */
  declare static type?: string

  /**
   * The Lucid model this resource describes. Required when registering the
   * resource explicitly.
   */
  declare static model?: () => LucidModel

  /**
   * Restrict which Lucid relationships are exposed as JSON:API
   * relationships. Defaults to every relation defined on the model.
   */
  declare static exposeRelationships?: string[]

  /**
   * Declared ?filter[...] parameters. Nothing is filterable unless listed
   * here — see the `filter` helpers (filter.eq, filter.gte,
   * filter.relation, filter.custom).
   */
  declare static filters?: Record<string, FilterHandler>

  constructor(
    protected resource: Row,
    protected ctx?: HttpContext
  ) {}

  get Model(): LucidModel {
    return this.resource.constructor as LucidModel
  }

  /**
   * The resource id. JSON:API requires ids to be strings.
   */
  id(): string {
    return String(this.resource.$primaryKeyValue)
  }

  /**
   * Attribute members of the resource object. Defaults to every serializable
   * column except the primary key and belongsTo foreign keys (which are
   * represented as relationships instead, per JSON:API recommendations).
   */
  attributes(): Record<string, unknown> {
    const serialized = this.resource.serializeAttributes()
    for (const name of this.#nonAttributeSerializedNames()) {
      delete serialized[name]
    }
    return serialized
  }

  /**
   * Per-resource links. Return undefined to omit. The document builder adds
   * a `self` link automatically when a base URL is configured.
   */
  links(): Links | undefined {
    return undefined
  }

  /**
   * Per-resource meta. Return undefined to omit.
   */
  meta(): Meta | undefined {
    return undefined
  }

  /**
   * Helper to cherry-pick model attributes by their serialized names.
   */
  protected pick(names: string[]): Record<string, unknown> {
    const serialized = this.resource.serializeAttributes()
    return Object.fromEntries(Object.entries(serialized).filter(([name]) => names.includes(name)))
  }

  /**
   * Serialized names of the primary key and belongsTo foreign key columns —
   * excluded from attributes because they are conveyed by `id` and
   * `relationships` respectively.
   */
  #nonAttributeSerializedNames(): string[] {
    const Model = this.Model
    const names: string[] = []

    for (const [attribute, column] of Model.$columnsDefinitions) {
      if (column.isPrimary) {
        names.push(column.serializeAs ?? attribute)
      }
    }

    for (const [, relation] of Model.$relationsDefinitions) {
      if (relation.type !== 'belongsTo') continue
      relation.boot()
      const foreignKey = (relation as unknown as { foreignKey: string }).foreignKey
      const column = Model.$columnsDefinitions.get(foreignKey)
      if (column) {
        names.push(column.serializeAs ?? foreignKey)
      }
    }

    return names
  }
}
