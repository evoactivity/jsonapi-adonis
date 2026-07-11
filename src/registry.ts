import string from '@adonisjs/core/helpers/string'
import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model'
import { JsonApiResource } from './resource.ts'

export type JsonApiResourceClass = Pick<
  typeof JsonApiResource,
  'type' | 'model' | 'exposeRelationships' | 'filters'
> & {
  /**
   * `never` parameters keep subclass constructors (which narrow the row and
   * ctx types, e.g. `Article` + `HttpContext`) assignable under strict
   * contravariance; instantiation goes through instantiateResource() below.
   */
  new (resource: never, ctx?: never): JsonApiResource<LucidRow>
}

/**
 * Instantiates a resource definition for a row. The construct signature on
 * JsonApiResourceClass uses a `never` parameter for variance reasons; this
 * is the one sanctioned bridge past it.
 */
export function instantiateResource(
  ResourceClass: JsonApiResourceClass,
  row: LucidRow,
  ctx?: unknown
): JsonApiResource<LucidRow> {
  return new ResourceClass(row as never, ctx as never)
}

/**
 * Maps Lucid models to their JSON:API resource classes. Models without an
 * explicit resource get an auto-derived one (camelCased table name as type,
 * all serializable columns as attributes, all relations exposed).
 */
export class JsonApiRegistry {
  #byModel = new Map<LucidModel, JsonApiResourceClass>()
  #typeByModel = new Map<LucidModel, string>()

  register(resources: JsonApiResourceClass[]) {
    for (const resource of resources) {
      if (!resource.model) {
        throw new Error(`JSON:API resource "${resource.name}" must define a static model property`)
      }
      this.#byModel.set(resource.model(), resource)
    }
    return this
  }

  /**
   * The JSON:API type string for a model class. Defaults to the kebab-cased
   * table name (auth_access_tokens → auth-access-tokens); hyphens are legal
   * in type values per the spec's member-name character rules.
   */
  typeFor(Model: LucidModel): string {
    const cached = this.#typeByModel.get(Model)
    if (cached) return cached

    const resource = this.#byModel.get(Model)
    const type = resource?.type ?? string.dashCase(Model.table)
    this.#typeByModel.set(Model, type)
    return type
  }

  /**
   * The resource class for a model class, auto-derived when not registered.
   */
  resourceFor(Model: LucidModel): JsonApiResourceClass {
    let resource = this.#byModel.get(Model)
    if (!resource) {
      resource = class extends JsonApiResource {}
      this.#byModel.set(Model, resource)
    }
    return resource
  }

  resourceForRow(row: LucidRow): JsonApiResourceClass {
    return this.resourceFor(row.constructor as LucidModel)
  }
}
