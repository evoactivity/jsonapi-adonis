import string from '@adonisjs/core/helpers/string'
import type { HttpContext } from '@adonisjs/core/http'
import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model'
import type { Links, Meta } from './types.ts'
import type { FilterHandler } from './filters.ts'
import type { JsonApiResourceClass } from './registry.ts'

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
/**
 * The single home for the relation-visibility rule: a relation is exposed
 * unless the model hides it (serializeAs: null) or the resource leaves it
 * out of exposeRelationships. Shared by include validation and
 * serialization so the two can never drift apart.
 */
export function isRelationExposed(
  ResourceClass: { exposeRelationships?: string[] },
  name: string,
  relation: { serializeAs?: string | null }
): boolean {
  if (relation.serializeAs === null) return false
  return !ResourceClass.exposeRelationships || ResourceClass.exposeRelationships.includes(name)
}

export class JsonApiResource<Row extends LucidRow = LucidRow> {
  /**
   * The JSON:API resource type. Defaults to the kebab-cased table name of
   * the model.
   */
  declare static type?: string

  /**
   * The JSON:API type this resource serializes as. The single home for
   * type derivation: the registry consults it for models and rows alike.
   * Override it to compute types under a different scheme entirely.
   */
  static typeName(this: JsonApiResourceClass): string {
    if (this.type) return this.type
    const Model = this.model?.()
    if (!Model) {
      throw new Error(
        `JSON:API resource "${this.name}" must declare a static type or model to derive its type`
      )
    }
    return string.dashCase(Model.table)
  }

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

  /**
   * For the base resource of a single-table inheritance family: the
   * concrete resources rows of this model can serialize as. Declaring this
   * makes relations targeting the base accept any member type on writes,
   * and switches unloaded belongsTo linkage to links-only (the concrete
   * type of an unloaded row is unknowable from a bare foreign key).
   */
  declare static subtypes?: () => JsonApiResourceClass[]

  /**
   * For the base resource of a single-table inheritance family: maps a row
   * to its concrete resource, typically by reading the discriminator
   * column. Returning undefined keeps the row on this resource. Consulted
   * by the registry wherever a row is serialized, so linkage and included
   * documents carry concrete types.
   */
  declare static resolveResource?: (row: never) => JsonApiResourceClass | undefined

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
   * Extra per-resource links, merged over the generated ones. Return
   * undefined to add nothing. The document builder generates the `self`
   * link from named routes; keys returned here override it.
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
