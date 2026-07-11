import type { HttpContext } from '@adonisjs/core/http'
import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model'
import { getAttribute } from './lucid_access.ts'
import type {
  Document,
  IncludeTree,
  JsonApiQueryParams,
  Links,
  Meta,
  RelationshipObject,
  ResourceIdentifier,
  ResourceObject,
} from './types.ts'
import { JSON_API_VERSION } from './types.ts'
import { instantiateResource, type JsonApiRegistry } from './registry.ts'
import type { LinkBuilder } from './links.ts'

export type Paginatorish = {
  all(): LucidRow[]
  getMeta(): Record<string, unknown>
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

function isPaginator(value: unknown): value is Paginatorish {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<Paginatorish>
  return typeof candidate.all === 'function' && typeof candidate.getMeta === 'function'
}

/**
 * Builds JSON:API compound documents from Lucid rows, driven entirely by
 * Lucid's own metadata ($columnsDefinitions, $relationsDefinitions,
 * $preloaded) plus the parsed request parameters.
 */
export class DocumentBuilder {
  #registry: JsonApiRegistry
  #params: JsonApiQueryParams
  #links: LinkBuilder
  #ctx?: HttpContext
  #included = new Map<string, ResourceObject>()

  constructor(
    registry: JsonApiRegistry,
    params: JsonApiQueryParams,
    links: LinkBuilder,
    ctx?: HttpContext
  ) {
    this.#registry = registry
    this.#params = params
    this.#links = links
    this.#ctx = ctx
  }

  build(
    input: LucidRow | LucidRow[] | Paginatorish | null,
    extras: { meta?: Meta; links?: Links } = {}
  ): Document {
    const document: Document = { jsonapi: { version: JSON_API_VERSION } }
    let rows: LucidRow[]
    let paginator: Paginatorish | undefined

    if (isPaginator(input)) {
      paginator = input
      rows = input.all()
    } else {
      rows = input === null ? [] : Array.isArray(input) ? input : [input]
    }

    const primary = rows.map((row) => this.#buildResource(row, this.#params.include))
    const primaryKeys = new Set(primary.map((resource) => `${resource.type}:${resource.id}`))

    document.data = input === null ? null : Array.isArray(input) || paginator ? primary : primary[0]

    const included = [...this.#included.entries()]
      .filter(([key]) => !primaryKeys.has(key))
      .map(([, resource]) => resource)
    if (included.length) {
      document.included = included
    }

    const links: Links = { ...extras.links }
    const meta: Meta = { ...extras.meta }

    if (paginator) {
      Object.assign(links, this.#paginationLinks(paginator))
      meta.page = {
        number: paginator.currentPage,
        size: paginator.perPage,
        total: paginator.total,
        lastPage: paginator.lastPage,
      }
    } else if (this.#ctx && this.#links.enabled) {
      links.self = this.#ctx.request.url(true)
    }

    if (Object.keys(links).length) document.links = links
    if (Object.keys(meta).length) document.meta = meta

    return document
  }

  /**
   * Builds a single resource object and collects resources reachable through
   * the include tree into the `included` map (deduped by type:id).
   */
  #buildResource(row: LucidRow, include: IncludeTree): ResourceObject {
    const Model = row.constructor as LucidModel
    const ResourceClass = this.#registry.resourceForRow(row)
    const definition = instantiateResource(ResourceClass, row, this.#ctx)
    const type = this.#registry.typeFor(Model)
    const id = definition.id()
    const allowedFields = this.#params.fields[type]

    let attributes = definition.attributes()
    if (allowedFields) {
      attributes = Object.fromEntries(
        Object.entries(attributes).filter(([name]) => allowedFields.includes(name))
      )
    }

    const resource: ResourceObject = { type, id }
    if (Object.keys(attributes).length) resource.attributes = attributes

    const relationships = this.#buildRelationships(row, Model, ResourceClass, include, {
      type,
      id,
      allowedFields,
    })
    if (Object.keys(relationships).length) resource.relationships = relationships

    const links = { ...this.#links.resourceLinks(type, id), ...definition.links() }
    if (Object.keys(links).length) resource.links = links

    const meta = definition.meta()
    if (meta && Object.keys(meta).length) resource.meta = meta

    return resource
  }

  #buildRelationships(
    row: LucidRow,
    Model: LucidModel,
    ResourceClass: { exposeRelationships?: string[] },
    include: IncludeTree,
    context: { type: string; id: string; allowedFields?: string[] }
  ): Record<string, RelationshipObject> {
    const relationships: Record<string, RelationshipObject> = {}

    for (const [name, relation] of Model.$relationsDefinitions) {
      if (ResourceClass.exposeRelationships && !ResourceClass.exposeRelationships.includes(name)) {
        continue
      }
      if (relation.serializeAs === null) continue
      const serializedName = relation.serializeAs ?? name

      // Sparse fieldsets restrict relationship members too (spec: "fields"
      // covers both attributes and relationships).
      if (context.allowedFields && !context.allowedFields.includes(serializedName)) {
        continue
      }

      const subInclude = include[name]
      const preloaded = name in row.$preloaded ? row.$preloaded[name] : undefined
      const relationship: RelationshipObject = {}

      if (preloaded !== undefined) {
        relationship.data = this.#linkage(preloaded, subInclude)
      } else if (relation.type === 'belongsTo') {
        // Resource linkage for an unloaded belongsTo is derivable from the
        // foreign key without touching the database.
        relation.boot()
        const foreignKey = (relation as unknown as { foreignKey: string }).foreignKey
        const value = getAttribute(row, foreignKey)
        relationship.data =
          typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
            ? { type: this.#registry.typeFor(relation.relatedModel()), id: String(value) }
            : null
      }

      const links = this.#links.relationshipLinks(context.type, context.id, serializedName)
      if (links) relationship.links = links

      // A relationship object must contain at least one of links/data/meta.
      if (relationship.data !== undefined || relationship.links) {
        relationships[serializedName] = relationship
      }
    }

    return relationships
  }

  #linkage(
    preloaded: LucidRow | LucidRow[] | null,
    subInclude: IncludeTree | undefined
  ): ResourceIdentifier | ResourceIdentifier[] | null {
    if (preloaded === null) return null

    const identify = (related: LucidRow): ResourceIdentifier => {
      if (subInclude) this.#visitIncluded(related, subInclude)
      const RelatedModel = related.constructor as LucidModel
      const ResourceClass = this.#registry.resourceForRow(related)
      const definition = instantiateResource(ResourceClass, related, this.#ctx)
      return { type: this.#registry.typeFor(RelatedModel), id: definition.id() }
    }

    return Array.isArray(preloaded) ? preloaded.map(identify) : identify(preloaded)
  }

  #visitIncluded(row: LucidRow, include: IncludeTree) {
    const type = this.#registry.typeFor(row.constructor as LucidModel)
    const ResourceClass = this.#registry.resourceForRow(row)
    const id = instantiateResource(ResourceClass, row, this.#ctx).id()
    const key = `${type}:${id}`

    const resource = this.#buildResource(row, include)
    const existing = this.#included.get(key)
    if (existing) {
      // The same resource can be reached through multiple include paths —
      // merge relationship members discovered along each path.
      if (resource.relationships) {
        existing.relationships = { ...existing.relationships, ...resource.relationships }
      }
    } else {
      this.#included.set(key, resource)
    }
  }

  /**
   * Pagination links per spec: first/last/prev/next, preserving all other
   * query parameters of the current request.
   */
  #paginationLinks(paginator: Paginatorish): Links {
    const links: Links = {}
    const pageUrl = (number: number | null) => {
      if (number === null) return null
      if (!this.#ctx) return null
      const qs: Record<string, unknown> = { ...this.#ctx.request.qs() }
      const page = typeof qs.page === 'object' && qs.page !== null ? qs.page : {}
      qs.page = { ...page, number: String(number) }
      return this.#ctx.request.url() + '?' + encodeQueryString(qs)
    }

    links.first = pageUrl(1)
    links.last = pageUrl(paginator.lastPage)
    links.prev = paginator.currentPage > 1 ? pageUrl(paginator.currentPage - 1) : null
    links.next =
      paginator.currentPage < paginator.lastPage ? pageUrl(paginator.currentPage + 1) : null
    return links
  }
}

/**
 * Encodes a nested query-string object using bracket notation
 * (page[number]=2&fields[articles]=title).
 */
function encodeQueryString(qs: Record<string, unknown>): string {
  const pairs: string[] = []
  const walk = (value: unknown, prefix: string) => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(value.join(','))}`)
    } else if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(child, prefix ? `${prefix}[${key}]` : key)
      }
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`)
    }
  }
  walk(qs, '')
  return pairs.join('&')
}
