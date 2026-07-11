import type { IncludeTree, JsonApiQueryParams, SortField, SparseFieldsets } from './types.ts'
import { JsonApiException } from './errors.ts'

const RESERVED_PARAMS = new Set(['include', 'fields', 'sort', 'page', 'filter'])

/**
 * Parses the JSON:API reserved query parameters (include, fields, sort,
 * page, filter) from an already-parsed query string object.
 */
export function parseQueryParams(qs: Record<string, unknown>): JsonApiQueryParams {
  rejectUnknownLowercaseParams(qs)
  return {
    include: parseInclude(qs.include),
    fields: parseFields(qs.fields),
    sort: parseSort(qs.sort),
    page: parsePage(qs.page),
    filter: isPlainObject(qs.filter) ? qs.filter : {},
  }
}

/**
 * The spec reserves simple lowercase names for itself: implementation-
 * specific query parameters MUST contain at least one non a-z character
 * (e.g. camelCase or snake_case). A lowercase parameter we don't recognize
 * is therefore a 400: https://jsonapi.org/format/#query-parameters
 *
 * Parameters that follow the implementation-specific naming convention are
 * ignored — they belong to the application.
 */
function rejectUnknownLowercaseParams(qs: Record<string, unknown>): void {
  for (const name of Object.keys(qs)) {
    if (RESERVED_PARAMS.has(name)) continue
    if (/^[a-z]+$/.test(name)) {
      throw JsonApiException.invalidQueryParameter(
        name,
        `"${name}" is not a query parameter defined by the JSON:API specification. ` +
          'Implementation-specific parameters must contain at least one non a-z character'
      )
    }
  }
}

/**
 * Normalizes a comma-separated parameter. AdonisJS parses query strings with
 * comma-splitting enabled, so `include=a,b` arrives as ['a', 'b'] while
 * `include=a` stays a string.
 */
export function csvList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
  }
  if (typeof raw === 'string' && raw !== '') {
    return raw.split(',')
  }
  return []
}

function parseInclude(raw: unknown): IncludeTree {
  const tree: IncludeTree = {}
  for (const path of csvList(raw)) {
    let node = tree
    for (const segment of path.trim().split('.')) {
      if (!segment) {
        throw JsonApiException.invalidQueryParameter('include', `Malformed include path "${path}"`)
      }
      node = node[segment] ??= {}
    }
  }
  return tree
}

function parseFields(raw: unknown): SparseFieldsets {
  if (!isPlainObject(raw)) return {}

  const fields: SparseFieldsets = {}
  for (const [type, value] of Object.entries(raw)) {
    if (typeof value !== 'string' && !Array.isArray(value)) {
      throw JsonApiException.invalidQueryParameter(
        `fields[${type}]`,
        'Sparse fieldsets must be comma-separated strings'
      )
    }
    fields[type] = csvList(value).map((field) => field.trim())
  }
  return fields
}

function parseSort(raw: unknown): SortField[] {
  return csvList(raw).map((entry) => {
    const trimmed = entry.trim()
    const direction = trimmed.startsWith('-') ? ('desc' as const) : ('asc' as const)
    const field = trimmed.replace(/^-/, '')
    if (!field) {
      throw JsonApiException.invalidQueryParameter('sort', `Malformed sort field "${entry}"`)
    }
    return { field, direction }
  })
}

function parsePage(raw: unknown): JsonApiQueryParams['page'] {
  if (!isPlainObject(raw)) return null

  const number = positiveInt(raw.number, 'page[number]') ?? 1
  const size = positiveInt(raw.size, 'page[size]') ?? 20
  return { number, size }
}

function positiveInt(value: unknown, parameter: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw JsonApiException.invalidQueryParameter(
      parameter,
      `"${JSON.stringify(value)}" is not a positive integer`
    )
  }
  return parsed
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
