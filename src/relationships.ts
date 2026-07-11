import string from '@adonisjs/core/helpers/string'
import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model'
import { loadRelation, relatedClient, setAttribute } from './lucid_access.ts'
import { JsonApiException } from './errors.ts'
import { verifyRelatedExist } from './deserializer.ts'
import type { JsonApiRegistry } from './registry.ts'
import type { ResourceIdentifier } from './types.ts'

export type RelationshipAction = 'replace' | 'add' | 'remove'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidLinkage(detail: string): JsonApiException {
  return new JsonApiException(
    { title: 'Invalid JSON:API Document', detail, source: { pointer: '/data' } },
    { status: 400 }
  )
}

/**
 * Resolves a relationship by name, accepting both the Lucid relation name
 * and its kebab-cased URL segment (received-comments → receivedComments).
 * Returns the booted relation; use relation.relationName for Lucid calls.
 */
export function getRelationOrFail(Model: LucidModel, name: string) {
  const relation =
    Model.$relationsDefinitions.get(name) ?? Model.$relationsDefinitions.get(string.camelCase(name))
  if (!relation || relation.serializeAs === null) {
    throw new JsonApiException(
      { title: 'Not Found', detail: `"${name}" is not a relationship of ${Model.name}` },
      { status: 404 }
    )
  }
  relation.boot()
  return relation
}

/**
 * Parses the body of a relationship-endpoint write request into resource
 * identifiers, validating linkage structure and type membership.
 */
function parseLinkage(
  body: unknown,
  relatedType: string,
  cardinality: 'to-one' | 'to-many'
): ResourceIdentifier[] | null {
  if (!isPlainObject(body) || !('data' in body)) {
    throw invalidLinkage('The request body must be an object with a "data" member')
  }
  const { data } = body

  const identify = (value: unknown): ResourceIdentifier => {
    if (!isPlainObject(value) || typeof value.type !== 'string' || typeof value.id !== 'string') {
      throw invalidLinkage('Resource identifier objects must have string "type" and "id"')
    }
    if (value.type !== relatedType) {
      throw new JsonApiException(
        {
          title: 'Conflict',
          detail: `This relationship holds resources of type "${relatedType}"`,
          source: { pointer: '/data' },
        },
        { status: 409 }
      )
    }
    return { type: value.type, id: value.id }
  }

  if (cardinality === 'to-one') {
    if (data === null) return null
    return [identify(data)]
  }
  if (!Array.isArray(data)) {
    throw invalidLinkage('To-many relationship updates require an array as "data"')
  }
  return data.map(identify)
}

/**
 * Applies a relationship-endpoint write (PATCH/POST/DELETE
 * /:id/relationships/:name) to a Lucid row.
 */
export async function updateRelationship(
  row: LucidRow,
  name: string,
  registry: JsonApiRegistry,
  body: unknown,
  action: RelationshipAction
): Promise<void> {
  const Model = row.constructor as LucidModel
  const relation = getRelationOrFail(Model, name)
  const relationName = relation.relationName
  const relatedType = registry.typeFor(relation.relatedModel())

  if (relation.type === 'belongsTo') {
    if (action !== 'replace') {
      throw new JsonApiException(
        { title: 'Method Not Allowed', detail: 'To-one relationships only support PATCH' },
        { status: 405 }
      )
    }
    const identifiers = parseLinkage(body, relatedType, 'to-one')
    const foreignKey = (relation as unknown as { foreignKey: string }).foreignKey
    if (identifiers === null) {
      setAttribute(row, foreignKey, null)
    } else {
      await verifyRelatedExist(Model, [{ relation: relationName, ids: [identifiers[0].id] }])
      setAttribute(row, foreignKey, identifiers[0].id)
    }
    await row.save()
    return
  }

  if (relation.type === 'manyToMany') {
    const identifiers = parseLinkage(body, relatedType, 'to-many')!
    const ids = identifiers.map((identifier) => identifier.id)
    await verifyRelatedExist(Model, [{ relation: relationName, ids }])
    const related = relatedClient(row, relationName)

    if (action === 'replace') {
      await related.sync(ids, true)
    } else if (action === 'add') {
      // sync with detach=false adds missing members without duplicating
      // existing ones (spec requirement for POST)
      await related.sync(ids, false)
    } else {
      await related.detach(ids)
    }
    return
  }

  if (relation.type === 'hasMany') {
    if (action !== 'add') {
      throw new JsonApiException(
        {
          title: 'Forbidden',
          detail: `Full replacement or removal through "${name}" is not supported`,
        },
        { status: 403 }
      )
    }
    const identifiers = parseLinkage(body, relatedType, 'to-many')!
    const ids = identifiers.map((identifier) => identifier.id)
    await verifyRelatedExist(Model, [{ relation: relationName, ids }])
    const RelatedModel = relation.relatedModel()
    const children = await RelatedModel.query().whereIn(RelatedModel.primaryKey, ids)
    await relatedClient(row, relationName).saveMany(children)
    return
  }

  throw new JsonApiException(
    { title: 'Forbidden', detail: `Writing through "${name}" is not supported` },
    { status: 403 }
  )
}

/**
 * Loads (or reloads) a relation and returns its current linkage.
 */
export async function fetchLinkage(
  row: LucidRow,
  name: string,
  registry: JsonApiRegistry
): Promise<ResourceIdentifier | ResourceIdentifier[] | null> {
  const Model = row.constructor as LucidModel
  const relation = getRelationOrFail(Model, name)
  const relationName = relation.relationName
  await loadRelation(row, relationName)
  const loaded = row.$preloaded[relationName] as LucidRow | LucidRow[] | null | undefined

  const identify = (related: LucidRow): ResourceIdentifier => ({
    type: registry.typeFor(related.constructor as LucidModel),
    id: String(related.$primaryKeyValue),
  })

  if (relation.type === 'belongsTo' || relation.type === 'hasOne') {
    return loaded ? identify(loaded as LucidRow) : null
  }
  return ((loaded as LucidRow[]) ?? []).map(identify)
}
