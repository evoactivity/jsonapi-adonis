import type { HttpContext } from '@adonisjs/core/http'
import type { LucidModel, LucidRow, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { Document, JsonApiQueryParams, Links, Meta } from './types.ts'
import { JSON_API_MEDIA_TYPE, JSON_API_VERSION } from './types.ts'
import { parseQueryParams } from './params.ts'
import { DocumentBuilder, type Paginatorish } from './document_builder.ts'
import { loadRelation, relatedClient, type DynamicModelQuery } from './lucid_access.ts'
import { LinkBuilder, type RouterContract } from './links.ts'
import { applyIncludes, applySort, validateIncludeTree } from './query.ts'
import { applyFilters, type FilterQuery } from './filters.ts'
import {
  deserializeResourceDocument,
  verifyRelatedExist,
  type DeserializedResource,
} from './deserializer.ts'
import {
  fetchLinkage,
  updateRelationship,
  getRelationOrFail,
  type RelationshipAction,
} from './relationships.ts'
import type { JsonApiRegistry } from './registry.ts'
import type { ResolvedJsonApiConfig } from './define_config.ts'

/**
 * Request-scoped JSON:API helper, exposed as the `jsonApi` property on the
 * HttpContext.
 *
 * ```ts
 * async index({ jsonApi }: HttpContext) {
 *   const articles = await jsonApi.query(Article).paginate(...jsonApi.page)
 *   return jsonApi.render(articles)
 * }
 * ```
 */
export class JsonApiRequestContext {
  #ctx: HttpContext
  #registry: JsonApiRegistry
  #config: ResolvedJsonApiConfig
  #router?: RouterContract
  #params?: JsonApiQueryParams
  #links?: LinkBuilder

  constructor(
    ctx: HttpContext,
    registry: JsonApiRegistry,
    config: ResolvedJsonApiConfig,
    router?: RouterContract
  ) {
    this.#ctx = ctx
    this.#registry = registry
    this.#config = config
    this.#router = router
  }

  /**
   * The parsed JSON:API query parameters. Throws a 400 JsonApiException on
   * malformed parameters.
   */
  get params(): JsonApiQueryParams {
    return (this.#params ??= parseQueryParams(this.#ctx.request.qs()))
  }

  /**
   * Whether errors thrown by this request should render as JSON:API error
   * documents. Call from the application exception handler:
   *
   * ```ts
   * async handle(error: unknown, ctx: HttpContext) {
   *   if (ctx.jsonApi.handlesErrors()) {
   *     return renderJsonApiError(error, ctx, this.debug)
   *   }
   *   return super.handle(error, ctx)
   * }
   * ```
   *
   * Uses the `errorDetection` config predicate when set; otherwise detects
   * JSON:API requests automatically — the matched route was registered via
   * router.jsonApiResource(), or the client speaks the JSON:API media type.
   */
  handlesErrors(): boolean {
    if (this.#config.errorDetection) {
      return this.#config.errorDetection(this.#ctx)
    }

    const routeName = this.#ctx.route?.name
    if (routeName && LinkBuilder.namespaceOf(routeName) !== null) {
      return true
    }

    const accept = this.#ctx.request.header('accept') ?? ''
    const contentType = this.#ctx.request.header('content-type') ?? ''
    return accept.includes(JSON_API_MEDIA_TYPE) || contentType.includes(JSON_API_MEDIA_TYPE)
  }

  /**
   * The link builder for this request, namespaced by the current route's
   * name so generated URLs stay within the route group (e.g. /api/v1 vs
   * /api/v2) that served the request.
   */
  get links(): LinkBuilder {
    return (this.#links ??= new LinkBuilder(
      this.#config.links,
      this.#router,
      this.#ctx.route?.name
    ))
  }

  /**
   * [pageNumber, pageSize] tuple for Lucid's paginate(), honouring
   * ?page[number]= and ?page[size]=.
   */
  get page(): [number, number] {
    const page = this.params.page
    return [page?.number ?? 1, page?.size ?? this.#config.defaultPageSize]
  }

  /**
   * Builds a model query with the request's include paths preloaded, sort
   * applied, and declared filters applied. Invalid include/sort/filter
   * parameters throw a 400.
   */
  query<Model extends LucidModel>(model: Model): ModelQueryBuilderContract<Model> {
    validateIncludeTree(model, this.params.include)
    const query = model.query()
    /**
     * Variance bridge: Lucid's builder is generic over the concrete model
     * with literal-name preload typing, while this package works with
     * runtime strings. Widening to the structural/base-model view is safe —
     * includes/sort/filters only narrow result sets — and this is the
     * single place the bridge happens.
     */
    const dynamicQuery = query as unknown as DynamicModelQuery & FilterQuery
    applyIncludes(dynamicQuery, this.params.include)
    applySort(dynamicQuery, model, this.params.sort)
    applyFilters(dynamicQuery, model, this.#registry.resourceFor(model), this.params.filter)
    return query
  }

  /**
   * Serializes rows/paginator into a JSON:API document — a pure
   * transformation that never touches the response. Use render() to also
   * prepare the response.
   */
  serialize(
    input: LucidRow | LucidRow[] | Paginatorish | null,
    extras: { meta?: Meta; links?: Links } = {}
  ): Document {
    const builder = new DocumentBuilder(this.#registry, this.params, this.links, this.#ctx)
    return builder.build(input, extras)
  }

  /**
   * serialize() + response preparation: sets the JSON:API media type, the
   * status when given, and the Location header on 201.
   */
  render(
    input: LucidRow | LucidRow[] | Paginatorish | null,
    extras: { meta?: Meta; links?: Links; status?: number } = {}
  ): Document {
    const document = this.serialize(input, extras)
    if (extras.status) this.#ctx.response.status(extras.status)
    if (extras.status === 201 && !Array.isArray(document.data) && document.data?.type) {
      const location = this.links.resourceSelf(document.data.type, document.data.id)
      if (location) this.#ctx.response.header('location', location)
    }
    this.#ctx.response.header('content-type', JSON_API_MEDIA_TYPE)
    return document
  }

  /**
   * Deserializes the request body as a JSON:API resource document for the
   * given model: 400 on malformed documents, 409 on type/id conflicts, 403
   * on client-generated ids, 404 when referenced related resources do not
   * exist. Returns model-ready attributes (to-one relationships mapped to
   * foreign keys) plus to-many id lists for syncToMany().
   */
  async deserialize(
    model: LucidModel,
    options: { expectedId?: string } = {}
  ): Promise<DeserializedResource> {
    const result = deserializeResourceDocument(model, this.#registry, this.#ctx.request.body(), {
      expectedId: options.expectedId,
      allowClientIds: this.#config.allowClientIds,
    })
    await verifyRelatedExist(model, result.references)
    return result
  }

  /**
   * Applies deserialized to-many relationships (manyToMany sync, hasMany
   * adoption) to a persisted row.
   */
  async syncToMany(row: LucidRow, toMany: Record<string, string[]>): Promise<void> {
    const Model = row.constructor as LucidModel
    for (const [name, ids] of Object.entries(toMany)) {
      const relation = Model.$relationsDefinitions.get(name)!
      if (relation.type === 'manyToMany') {
        await relatedClient(row, name).sync(ids)
      } else {
        const RelatedModel = relation.relatedModel()
        const children = await RelatedModel.query().whereIn(RelatedModel.primaryKey, ids)
        await relatedClient(row, name).saveMany(children)
      }
    }
  }

  /**
   * Renders a relationship linkage document for GET
   * /:id/relationships/:name endpoints.
   */
  async renderRelationship(row: LucidRow, name: string): Promise<Document> {
    const linkage = await fetchLinkage(row, name, this.#registry)
    const Model = row.constructor as LucidModel
    const type = this.#registry.typeFor(Model)
    const id = String(row.$primaryKeyValue)

    const document: Document = { jsonapi: { version: JSON_API_VERSION }, data: linkage }
    const links = this.links.relationshipLinks(type, id, name)
    if (links) document.links = links
    this.#ctx.response.header('content-type', JSON_API_MEDIA_TYPE)
    return document
  }

  /**
   * Applies a relationship write (PATCH=replace, POST=add, DELETE=remove)
   * from the request body, then returns the updated linkage document.
   */
  async updateRelationship(
    row: LucidRow,
    name: string,
    action: RelationshipAction
  ): Promise<Document> {
    await updateRelationship(row, name, this.#registry, this.#ctx.request.body(), action)
    return this.renderRelationship(row, name)
  }

  /**
   * Renders the related resources themselves, for GET /:id/:name endpoints
   * (the `related` link target).
   */
  async renderRelated(row: LucidRow, name: string): Promise<Document> {
    const Model = row.constructor as LucidModel
    const relation = getRelationOrFail(Model, name)
    const relationName = relation.relationName
    await loadRelation(row, relationName)
    const loaded = row.$preloaded[relationName] as LucidRow | LucidRow[] | null | undefined

    if (relation.type === 'belongsTo' || relation.type === 'hasOne') {
      return this.render((loaded as LucidRow) ?? null)
    }
    return this.render((loaded as LucidRow[]) ?? [])
  }
}
