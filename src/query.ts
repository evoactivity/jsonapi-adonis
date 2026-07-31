import type { ExtractScopes, LucidModel } from '@adonisjs/lucid/types/model'
import type { ExtractModelRelations } from '@adonisjs/lucid/types/relations'
import type { IncludeTree, SortField } from './types.ts'
import type { DynamicModelQuery, DynamicScopes } from './lucid_access.ts'
import type { JsonApiRegistry } from './registry.ts'
import { isRelationExposed } from './resource.ts'
import { JsonApiException } from './errors.ts'

/**
 * The related model behind a relation property. Every Lucid relation type
 * (HasMany, BelongsTo, …) carries its related model constructor as `model`.
 */
type RelatedModelOf<Row, Key extends keyof Row> =
  NonNullable<Row[Key]> extends { model: infer Model extends LucidModel } ? Model : never

/**
 * A scope for one relation, typed to that relation's related model so its
 * named scopes autocomplete, exactly like Lucid's withScopes() callback.
 * Either a bare callback (scope this relation) or an object that also
 * carries scopes for deeper includes.
 */
export type PreloadScopeEntry<Related extends LucidModel> =
  | ((scopes: ExtractScopes<Related>) => void)
  | {
      scope?: (scopes: ExtractScopes<Related>) => void
      preload?: PreloadScopeMap<Related>
    }

/**
 * The argument to withPreloadScopes(): keyed by the model's relation names,
 * each entry typed to that relation's related model. Recurse through
 * `preload` to constrain nested includes, typed at every level.
 */
export type PreloadScopeMap<Model extends LucidModel> = {
  [Key in ExtractModelRelations<InstanceType<Model>>]?: PreloadScopeEntry<
    RelatedModelOf<InstanceType<Model>, Key>
  >
}

/**
 * The runtime, model-agnostic view of a preload-scope tree, mirroring the
 * include tree. The public PreloadScopeMap<Model> narrows this per model
 * for the caller; internally we walk this loose shape.
 */
export type PreloadScope = (scopes: DynamicScopes) => void
export type PreloadScopeNode = PreloadScope | { scope?: PreloadScope; preload?: PreloadScopeTree }
export type PreloadScopeTree = Record<string, PreloadScopeNode>

/**
 * Preload-scope trees are attached to a query builder out of band so the
 * `withPreloadScopes()` builder macro (which only has `this`) and this
 * module (which builds the include preloads) can share one tree. A WeakMap
 * keyed by the builder keeps it off the builder's own surface and lets it
 * be garbage collected with the query.
 */
const preloadScopeTrees = new WeakMap<object, PreloadScopeTree>()

/**
 * Creates and registers a fresh preload-scope tree for a query builder.
 * Called once when the query is built; the returned tree is mutated in
 * place by later withPreloadScopes() calls and read at preload time.
 */
export function preloadScopesFor(query: object): PreloadScopeTree {
  const tree: PreloadScopeTree = {}
  preloadScopeTrees.set(query, tree)
  return tree
}

/**
 * Merges scopes into a query builder's preload-scope tree, the entry point
 * for the withPreloadScopes() macro. Safe to call before or after the
 * includes are built: the tree is read at preload (execution) time.
 */
export function addPreloadScopes(query: object, scopes: PreloadScopeTree): void {
  const existing = preloadScopeTrees.get(query)
  if (existing) Object.assign(existing, scopes)
  else preloadScopeTrees.set(query, { ...scopes })
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
 * Applies an include tree as nested preloads on a model query, walking the
 * preload-scope tree alongside it. Each relation is constrained by its
 * entry's scope (a bare callback, or the `scope` of an object entry), and
 * the entry's `preload` carries scopes for the next level down. The tree is
 * read here, inside the preload callback, which Lucid invokes at execution
 * time, so scopes added after the query is built (a `withPreloadScopes()`
 * chained after `jsonApi.query()`) still apply.
 */
export function applyIncludes(
  query: DynamicModelQuery,
  tree: IncludeTree,
  Model?: LucidModel,
  scopeTree?: PreloadScopeTree
): void {
  for (const [name, subTree] of Object.entries(tree)) {
    const RelatedModel = Model?.$relationsDefinitions.get(name)?.relatedModel()
    query.preload(name, (subQuery) => {
      const entry = scopeTree?.[name]
      const scope = typeof entry === 'function' ? entry : entry?.scope
      const childScopes = typeof entry === 'function' ? undefined : entry?.preload
      if (scope) subQuery.withScopes(scope)
      applyIncludes(subQuery, subTree, RelatedModel, childScopes)
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
