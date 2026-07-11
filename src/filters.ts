import type { LucidModel, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { JsonApiException } from './errors.ts'
import { csvList } from './params.ts'
import { resolveColumn } from './query.ts'

/**
 * The query builder handed to filters. Generic over the base model so one
 * handler type serves every resource; safe because filters only narrow
 * result sets.
 */
export type FilterQuery = ModelQueryBuilderContract<LucidModel>

/**
 * A declared filter: receives the model query builder, the raw value from
 * `?filter[name]=...` (a string, or an array when the client sent commas),
 * and metadata about where it is being applied.
 */
export type FilterHandler = (
  query: FilterQuery,
  value: unknown,
  context: { Model: LucidModel; name: string }
) => void

/**
 * Nothing is filterable unless the resource declares it:
 *
 * ```ts
 * export default class ArticleResource extends JsonApiResource<Article> {
 *   static filters = {
 *     title: filter.eq(),
 *     publishedAfter: filter.gte('createdAt'),
 *     author: filter.relation('author'),
 *     search: filter.custom((query, value) => {
 *       query.whereILike('title', `%${value}%`)
 *     }),
 *   }
 * }
 * ```
 *
 * Filter keys are the public parameter names; `eq`/comparison filters map
 * serialized attribute names to database columns automatically.
 */
export const filter = {
  /**
   * Equality on an attribute. A single value becomes `where`, multiple
   * (comma-separated) values become `whereIn`.
   *
   * @param attribute - Serialized attribute name; defaults to the filter key
   */
  eq(attribute?: string): FilterHandler {
    return (query, value, { Model, name }) => {
      const column = columnFor(Model, attribute ?? name)
      const values = csvList(value)
      if (values.length === 0) return
      if (values.length === 1) {
        // Lucid builders are thenables; `void` marks the chain call as
        // intentionally not awaited (execution happens later)
        void query.where(column, values[0])
      } else {
        void query.whereIn(column, values)
      }
    }
  },

  /** `where column > value` */
  gt(attribute?: string): FilterHandler {
    return comparison('>', attribute)
  },

  /** `where column >= value` */
  gte(attribute?: string): FilterHandler {
    return comparison('>=', attribute)
  },

  /** `where column < value` */
  lt(attribute?: string): FilterHandler {
    return comparison('<', attribute)
  },

  /** `where column <= value` */
  lte(attribute?: string): FilterHandler {
    return comparison('<=', attribute)
  },

  /**
   * Filter by a belongsTo relationship's id:
   * `?filter[author]=7` → `where author_id = 7` (multiple ids → whereIn).
   */
  relation(relationName: string): FilterHandler {
    return (query, value, { Model }) => {
      const relation = Model.$relationsDefinitions.get(relationName)
      if (!relation || relation.type !== 'belongsTo') {
        throw new Error(
          `filter.relation("${relationName}") on ${Model.name} requires a belongsTo relation`
        )
      }
      relation.boot()
      const foreignKey = (relation as unknown as { foreignKey: string }).foreignKey
      const column = Model.$columnsDefinitions.get(foreignKey)?.columnName ?? foreignKey
      const values = csvList(value)
      if (values.length === 0) return
      if (values.length === 1) {
        void query.where(column, values[0])
      } else {
        void query.whereIn(column, values)
      }
    }
  },

  /**
   * Full control: receive the Lucid query builder and the raw value.
   * Scopes, joins and subqueries all work here.
   */
  custom(handler: (query: FilterQuery, value: unknown) => void): FilterHandler {
    return (query, value) => handler(query, value)
  },
}

function comparison(operator: string, attribute?: string): FilterHandler {
  return (query, value, { Model, name }) => {
    const values = csvList(value)
    if (values.length === 0) return
    if (values.length > 1) {
      throw JsonApiException.invalidQueryParameter(
        `filter[${name}]`,
        'This filter accepts a single value'
      )
    }
    void query.where(columnFor(Model, attribute ?? name), operator, values[0])
  }
}

function columnFor(Model: LucidModel, serializedName: string): string {
  const column = resolveColumn(Model, serializedName)
  if (!column) {
    throw new Error(`Unknown attribute "${serializedName}" in filter declaration for ${Model.name}`)
  }
  return column
}

/**
 * Applies `?filter[...]` parameters against the filters declared on the
 * resource class. Undeclared filter names are a 400 per this package's
 * strict-input policy (mirroring include and sort).
 */
export function applyFilters(
  query: FilterQuery,
  Model: LucidModel,
  ResourceClass: { filters?: Record<string, FilterHandler> },
  filters: Record<string, unknown>
): void {
  for (const [name, value] of Object.entries(filters)) {
    const handler = ResourceClass.filters?.[name]
    if (!handler) {
      throw JsonApiException.invalidQueryParameter(
        `filter[${name}]`,
        `"${name}" is not a supported filter for ${Model.name}`
      )
    }
    handler(query, value, { Model, name })
  }
}
