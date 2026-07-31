import type { LucidModel } from '@adonisjs/lucid/types/model'
import type { IncludeTree, SortField } from './types.ts'
import type { DynamicModelQuery, DynamicScopes } from './lucid_access.ts'
import type { JsonApiRegistry } from './registry.ts'
import { isRelationExposed } from './resource.ts'
import { JsonApiException } from './errors.ts'

/**
 * A per-relation constraint applied to an included relation's preload
 * query. The callback is the exact shape of Lucid's withScopes() callback,
 * so a developer reuses the related model's own named scopes:
 * `{ episodes: (scopes) => scopes.published() }`.
 */
export type PreloadScope = (scopes: DynamicScopes) => void

/**
 * Relation name → preload scope. Keyed by relation name, applied wherever
 * that relation is preloaded in an include tree, at any depth.
 */
export type PreloadScopeMap = Record<string, PreloadScope>

/**
 * Preload-scope maps are attached to a query builder out of band so the
 * `withPreloadScopes()` builder macro (which only has `this`) and this
 * module (which builds the include preloads) can share one map. A WeakMap
 * keyed by the builder keeps it off the builder's own surface and lets it
 * be garbage collected with the query.
 */
const preloadScopeMaps = new WeakMap<object, PreloadScopeMap>()

/**
 * Creates and registers a fresh preload-scope map for a query builder.
 * Called once when the query is built; the returned map is mutated in
 * place by later withPreloadScopes() calls and read at preload time.
 */
export function preloadScopesFor(query: object): PreloadScopeMap {
  const map: PreloadScopeMap = {}
  preloadScopeMaps.set(query, map)
  return map
}

/**
 * Merges scopes into a query builder's preload-scope map, the entry point
 * for the withPreloadScopes() macro. Safe to call before or after the
 * includes are built: the map is read at preload (execution) time.
 */
export function addPreloadScopes(query: object, scopes: PreloadScopeMap): void {
  const existing = preloadScopeMaps.get(query)
  if (existing) Object.assign(existing, scopes)
  else preloadScopeMaps.set(query, { ...scopes })
}

/**
 * Validates every path of an include tree against the model's relationship
 * definitions. The spec requires a 400 when an unsupported include path is
 * requested. When a registry is given, relations left out of the resource's
 * exposeRelationships list are treated as unsupported too, so hidden
 * relations are rejected before any preloading happens.
 */
export function validateIncludeTree(
  Model: LucidModel,
  tree: IncludeTree,
  registry?: JsonApiRegistry
): void {
  validateIncludeLevel(Model, tree, registry, '')
}

function validateIncludeLevel(
  Model: LucidModel,
  tree: IncludeTree,
  registry: JsonApiRegistry | undefined,
  prefix: string
): void {
  const ResourceClass = registry?.resourceFor(Model) ?? {}
  for (const [name, subTree] of Object.entries(tree)) {
    const relation = Model.$relationsDefinitions.get(name)
    const path = prefix ? `${prefix}.${name}` : name
    if (!relation || !isRelationExposed(ResourceClass, name, relation)) {
      throw JsonApiException.invalidQueryParameter(
        'include',
        `"${path}" is not a supported include path for ${Model.name}`
      )
    }
    validateIncludeLevel(relation.relatedModel(), subTree, registry, path)
  }
}

/**
 * Applies an include tree as nested preloads on a model query. Each
 * preloaded relation is constrained by the matching entry in the
 * preload-scope map, if any, before recursing, so a scope keyed by
 * relation name applies wherever that relation appears in the tree, at any
 * depth. The map is read here, inside the preload callback, which Lucid
 * invokes at execution time, so scopes added after the query is built
 * (a `withPreloadScopes()` chained after `jsonApi.query()`) still apply.
 */
export function applyIncludes(
  query: DynamicModelQuery,
  tree: IncludeTree,
  Model?: LucidModel,
  preloadScopes?: PreloadScopeMap
): void {
  for (const [name, subTree] of Object.entries(tree)) {
    const RelatedModel = Model?.$relationsDefinitions.get(name)?.relatedModel()
    query.preload(name, (subQuery) => {
      const scope = preloadScopes?.[name]
      if (scope) subQuery.withScopes(scope)
      applyIncludes(subQuery, subTree, RelatedModel, preloadScopes)
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
