/**
 * JSON:API v1.1 document structure types.
 * https://jsonapi.org/format/
 */

export const JSON_API_MEDIA_TYPE = 'application/vnd.api+json'
export const JSON_API_VERSION = '1.1'

export type Meta = Record<string, unknown>

export type LinkObject = {
  href: string
  rel?: string
  describedby?: string
  title?: string
  type?: string
  hreflang?: string
  meta?: Meta
}

export type Link = string | LinkObject | null

export type Links = Record<string, Link>

export type ResourceIdentifier = {
  type: string
  id: string
  meta?: Meta
}

export type RelationshipObject = {
  data?: ResourceIdentifier | ResourceIdentifier[] | null
  links?: Links
  meta?: Meta
}

export type ResourceObject = {
  type: string
  id: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, RelationshipObject>
  links?: Links
  meta?: Meta
}

export type ErrorSource = {
  pointer?: string
  parameter?: string
  header?: string
}

export type ErrorObject = {
  id?: string
  links?: Links
  status?: string
  code?: string
  title?: string
  detail?: string
  source?: ErrorSource
  meta?: Meta
}

export type JsonApiObject = {
  version?: string
  ext?: string[]
  profile?: string[]
  meta?: Meta
}

export type Document = {
  data?: ResourceObject | ResourceObject[] | ResourceIdentifier | ResourceIdentifier[] | null
  errors?: ErrorObject[]
  meta?: Meta
  jsonapi?: JsonApiObject
  links?: Links
  included?: ResourceObject[]
}

/**
 * Parsed representation of the ?include= query parameter.
 * `include=comments.author,tags` becomes:
 * { comments: { author: {} }, tags: {} }
 */
export type IncludeTree = { [relation: string]: IncludeTree }

/**
 * Parsed ?fields[type]=a,b parameters, keyed by resource type.
 */
export type SparseFieldsets = Record<string, string[]>

/**
 * Parsed ?sort=-createdAt,title parameter.
 */
export type SortField = { field: string; direction: 'asc' | 'desc' }

/**
 * Parsed ?page[number]=&page[size]= parameters.
 */
export type PageParams = { number: number; size: number }

export type JsonApiQueryParams = {
  include: IncludeTree
  fields: SparseFieldsets
  sort: SortField[]
  page: PageParams | null
  filter: Record<string, unknown>
}
