import type { LucidModel } from '@adonisjs/lucid/types/model'
import type { IncludeTree, SortField } from './types.ts'
import type { DynamicModelQuery } from './lucid_access.ts'
import { JsonApiException } from './errors.ts'

/**
 * Validates every path of an include tree against the model's relationship
 * definitions. The spec requires a 400 when an unsupported include path is
 * requested.
 */
export function validateIncludeTree(Model: LucidModel, tree: IncludeTree, prefix = ''): void {
  for (const [name, subTree] of Object.entries(tree)) {
    const relation = Model.$relationsDefinitions.get(name)
    const path = prefix ? `${prefix}.${name}` : name
    if (!relation || relation.serializeAs === null) {
      throw JsonApiException.invalidQueryParameter(
        'include',
        `"${path}" is not a supported include path for ${Model.name}`
      )
    }
    validateIncludeTree(relation.relatedModel(), subTree, path)
  }
}

/**
 * Applies an include tree as nested preloads on a model query.
 */
export function applyIncludes(query: DynamicModelQuery, tree: IncludeTree): void {
  for (const [name, subTree] of Object.entries(tree)) {
    query.preload(name, (subQuery) => {
      applyIncludes(subQuery, subTree)
    })
  }
}

/**
 * Applies ?sort= fields to a model query, mapping serialized attribute
 * names back to database column names. Unknown fields are a 400 per spec.
 */
export function applySort(query: DynamicModelQuery, Model: LucidModel, sort: SortField[]): void {
  for (const { field, direction } of sort) {
    const column = resolveColumn(Model, field)
    if (!column) {
      throw JsonApiException.invalidQueryParameter(
        'sort',
        `"${field}" is not a sortable field for ${Model.name}`
      )
    }
    query.orderBy(column, direction)
  }
}

export function resolveColumn(Model: LucidModel, serializedName: string): string | undefined {
  for (const [attribute, column] of Model.$columnsDefinitions) {
    if ((column.serializeAs ?? attribute) === serializedName || attribute === serializedName) {
      return column.columnName
    }
  }
  return undefined
}
