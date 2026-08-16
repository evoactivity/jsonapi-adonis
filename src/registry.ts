import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model'
import { JsonApiResource } from './resource.ts'

export type JsonApiResourceClass = Pick<
  typeof JsonApiResource,
  'type' | 'model' | 'exposeRelationships' | 'filters' | 'subtypes' | 'resolveResource' | 'typeName'
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
  #typeByResource = new Map<JsonApiResourceClass, string>()

  register(resources: JsonApiResourceClass[]) {
    for (const resource of resources) {
      if (!resource.model) {
        throw new Error(`JSON:API resource "${resource.name}" must define a static model property`)
      }
      this.#byModel.set(resource.model(), resource)

      // A base resource registers its declared family, so one import line
      // covers an STI family. Explicit registrations win, so a subtype
      // whose model already has a resource is left alone, which also
      // bounds the recursion.
      for (const subtype of resource.subtypes?.() ?? []) {
        if (subtype.model && !this.#byModel.has(subtype.model())) {
          this.register([subtype])
        }
      }
    }
    return this
  }

  /**
   * The JSON:API type string for a model class. Defaults to the kebab-cased
   * table name (auth_access_tokens → auth-access-tokens); hyphens are legal
   * in type values per the spec's member-name character rules.
   */
  typeFor(Model: LucidModel): string {
    return this.#typeOf(this.resourceFor(Model))
  }

  /**
   * The resource class for a model class, auto-derived when not registered.
   */
  resourceFor(Model: LucidModel): JsonApiResourceClass {
    let resource = this.#byModel.get(Model)
    if (!resource) {
      resource = class extends JsonApiResource {
        static model = () => Model
      }
      this.#byModel.set(Model, resource)
    }
    return resource
  }

  /**
   * The resource class for a row, resolving through resolveResource when
   * the row's resource declares one (single-table inheritance). Hooks can
   * chain; a repeated class ends the walk so a cycle cannot loop.
   */
  resourceForRow(row: LucidRow): JsonApiResourceClass {
    let resource = this.resourceFor(row.constructor as LucidModel)
    const visited = new Set<JsonApiResourceClass>([resource])

    while (resource.resolveResource) {
      const resolved = resource.resolveResource(row as never)
      if (!resolved || visited.has(resolved)) break
      visited.add(resolved)
      resource = resolved
    }
    return resource
  }

  /**
   * The JSON:API type string for a row. Differs from typeFor(Model) only
   * when the row's resource resolves to a concrete subtype resource.
   */
  typeForRow(row: LucidRow): string {
    return this.#typeOf(this.resourceForRow(row))
  }

  /**
   * The types a relation targeting this model accepts on writes. A model
   * whose resource declares subtypes accepts every member of the family
   * and nothing else. The base's own abstract type never appears in
   * payloads. Every other model accepts its single type, as before.
   */
  acceptedTypesFor(Model: LucidModel): string[] {
    const subtypes = this.resourceFor(Model).subtypes?.()
    if (!subtypes) return [this.typeFor(Model)]
    return subtypes.map((subtype) => this.#typeOf(subtype))
  }

  /**
   * Every type string comes from resource.typeName(), cached per resource
   * class because row serialization is a hot path.
   */
  #typeOf(resource: JsonApiResourceClass): string {
    let type = this.#typeByResource.get(resource)
    if (!type) {
      type = resource.typeName()
      this.#typeByResource.set(resource, type)
    }
    return type
  }
}
