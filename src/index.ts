/**
 * JSON:API serialization plugin for AdonisJS + Lucid.
 */
export * from './types.ts'
export { JsonApiResource } from './resource.ts'
export { JsonApiRegistry, type JsonApiResourceClass } from './registry.ts'
export { DocumentBuilder } from './document_builder.ts'
export { LinkBuilder, type RouterContract } from './links.ts'
export { parseQueryParams } from './params.ts'
export { applyIncludes, applySort, validateIncludeTree } from './query.ts'
export { filter, applyFilters, type FilterHandler, type FilterQuery } from './filters.ts'
export { JsonApiException, toErrorDocument, renderJsonApiError } from './errors.ts'
export type { DynamicModelQuery } from './lucid_access.ts'
export { JsonApiRequestContext } from './context.ts'
export {
  defineConfig,
  type JsonApiConfig,
  type ResolvedJsonApiConfig,
  type LazyResourceImport,
} from './define_config.ts'
export {
  deserializeResourceDocument,
  verifyRelatedExist,
  type DeserializedResource,
} from './deserializer.ts'
export { updateRelationship, fetchLinkage, type RelationshipAction } from './relationships.ts'
export {
  registerJsonApiResource,
  type JsonApiResourceControllers,
  type JsonApiResourceOptions,
} from './routes.ts'
