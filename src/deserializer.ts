import type { LucidModel } from '@adonisjs/lucid/types/model'
import { JsonApiException } from './errors.ts'
import type { ResourceIdentifier } from './types.ts'
import type { JsonApiRegistry } from './registry.ts'

/**
 * Result of deserializing a JSON:API resource document into Lucid-friendly
 * shapes:
 * - `attributes` uses model attribute names (serialized names mapped back)
 *   and includes foreign keys derived from to-one relationships, so it can
 *   be passed straight to a validator or Model.create()/merge().
 * - `toMany` holds relation name → related ids, to be synced after save.
 */
export type DeserializedResource = {
  id?: string
  attributes: Record<string, unknown>
  toMany: Record<string, string[]>
  /**
   * Every related resource referenced by the document (to-one and to-many),
   * for existence verification (404 per spec).
   */
  references: { relation: string; ids: string[] }[]
}

export type DeserializeOptions = {
  /**
   * The id from the endpoint URL. When set (PATCH), data.id must be present
   * and match (400/409). When unset (POST), a client-generated id is
   * rejected with 403 unless allowClientIds is enabled.
   */
  expectedId?: string
  allowClientIds?: boolean
}

function invalidDocument(detail: string, pointer = '/data'): JsonApiException {
  return new JsonApiException(
    { title: 'Invalid JSON:API Document', detail, source: { pointer } },
    { status: 400 }
  )
}

function conflict(detail: string, pointer: string): JsonApiException {
  return new JsonApiException({ title: 'Conflict', detail, source: { pointer } }, { status: 409 })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Parses a resource identifier object, enforcing string type/id members.
 */
function parseIdentifier(value: unknown, pointer: string): ResourceIdentifier {
  if (!isPlainObject(value) || typeof value.type !== 'string' || typeof value.id !== 'string') {
    throw invalidDocument('Resource identifier objects must have string "type" and "id"', pointer)
  }
  return { type: value.type, id: value.id }
}

/**
 * Deserializes a JSON:API resource document (request body) targeting the
 * given model, per https://jsonapi.org/format/#crud
 */
export function deserializeResourceDocument(
  Model: LucidModel,
  registry: JsonApiRegistry,
  body: unknown,
  options: DeserializeOptions = {}
): DeserializedResource {
  const expectedType = registry.typeFor(Model)

  if (!isPlainObject(body) || !('data' in body)) {
    throw invalidDocument('The request body must be an object with a "data" member', '')
  }
  const data = body.data
  if (!isPlainObject(data)) {
    throw invalidDocument('The "data" member must be a single resource object')
  }
  if (typeof data.type !== 'string') {
    throw invalidDocument('The resource object must have a string "type" member', '/data/type')
  }
  if (data.type !== expectedType) {
    throw conflict(
      `Resource type "${data.type}" is not supported by this endpoint (expected "${expectedType}")`,
      '/data/type'
    )
  }

  let id: string | undefined
  if (options.expectedId !== undefined) {
    if (typeof data.id !== 'string') {
      throw invalidDocument('Update requests must include a string "id" member', '/data/id')
    }
    if (data.id !== options.expectedId) {
      throw conflict(
        `Resource id "${data.id}" does not match the endpoint id "${options.expectedId}"`,
        '/data/id'
      )
    }
    id = data.id
  } else if (data.id !== undefined) {
    if (!options.allowClientIds) {
      throw new JsonApiException(
        {
          title: 'Forbidden',
          detail: 'Client-generated ids are not supported by this endpoint',
          source: { pointer: '/data/id' },
        },
        { status: 403 }
      )
    }
    if (typeof data.id !== 'string') {
      throw invalidDocument('The "id" member must be a string', '/data/id')
    }
    id = data.id
  }

  const attributes = deserializeAttributes(Model, data.attributes)
  const { toMany, references } = deserializeRelationships(
    Model,
    registry,
    data.relationships,
    attributes
  )

  return { id, attributes, toMany, references }
}

/**
 * Maps serialized attribute names back to model attribute names, dropping
 * unknown members (they are left for validators to reject if desired).
 */
function deserializeAttributes(Model: LucidModel, raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) {
    throw invalidDocument('The "attributes" member must be an object', '/data/attributes')
  }
  if ('id' in raw || 'type' in raw) {
    throw invalidDocument('Attributes must not contain "id" or "type" members', '/data/attributes')
  }

  const bySerializedName = new Map<string, string>()
  for (const [attribute, column] of Model.$columnsDefinitions) {
    if (column.isPrimary) continue
    bySerializedName.set(column.serializeAs ?? attribute, attribute)
  }

  const attributes: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(raw)) {
    const attribute = bySerializedName.get(name)
    if (attribute) attributes[attribute] = value
  }
  return attributes
}

/**
 * Deserializes the relationships member: to-one relationships become
 * foreign-key attributes; to-many relationships are collected as id lists
 * for post-save syncing.
 */
function deserializeRelationships(
  Model: LucidModel,
  registry: JsonApiRegistry,
  raw: unknown,
  attributes: Record<string, unknown>
): { toMany: Record<string, string[]>; references: { relation: string; ids: string[] }[] } {
  const toMany: Record<string, string[]> = {}
  const references: { relation: string; ids: string[] }[] = []
  if (raw === undefined) return { toMany, references }
  if (!isPlainObject(raw)) {
    throw invalidDocument('The "relationships" member must be an object', '/data/relationships')
  }

  for (const [name, value] of Object.entries(raw)) {
    const pointer = `/data/relationships/${name}`
    const relation = Model.$relationsDefinitions.get(name)
    if (!relation || relation.serializeAs === null) {
      throw invalidDocument(`"${name}" is not a known relationship of ${Model.name}`, pointer)
    }
    if (!isPlainObject(value) || !('data' in value)) {
      throw invalidDocument(
        'Relationship objects in write requests must contain a "data" member',
        pointer
      )
    }
    relation.boot()
    const relatedType = registry.typeFor(relation.relatedModel())
    const linkage = value.data

    if (relation.type === 'belongsTo') {
      const foreignKey = (relation as unknown as { foreignKey: string }).foreignKey
      if (linkage === null) {
        attributes[foreignKey] = null
        continue
      }
      const identifier = parseIdentifier(linkage, `${pointer}/data`)
      if (identifier.type !== relatedType) {
        throw conflict(
          `Relationship "${name}" expects resources of type "${relatedType}"`,
          `${pointer}/data/type`
        )
      }
      attributes[foreignKey] = identifier.id
      references.push({ relation: name, ids: [identifier.id] })
    } else if (relation.type === 'manyToMany' || relation.type === 'hasMany') {
      if (!Array.isArray(linkage)) {
        throw invalidDocument(
          `Relationship "${name}" is to-many and requires an array as "data"`,
          `${pointer}/data`
        )
      }
      toMany[name] = linkage.map((entry, index) => {
        const identifier = parseIdentifier(entry, `${pointer}/data/${index}`)
        if (identifier.type !== relatedType) {
          throw conflict(
            `Relationship "${name}" expects resources of type "${relatedType}"`,
            `${pointer}/data/${index}/type`
          )
        }
        return identifier.id
      })
      references.push({ relation: name, ids: toMany[name] })
    } else {
      throw new JsonApiException(
        {
          title: 'Forbidden',
          detail: `Writing through the "${name}" relationship is not supported`,
          source: { pointer },
        },
        { status: 403 }
      )
    }
  }

  return { toMany, references }
}

/**
 * Verifies that every referenced related resource exists. The spec requires
 * a 404 when a request references a resource that does not exist.
 */
export async function verifyRelatedExist(
  Model: LucidModel,
  references: { relation: string; ids: string[] }[]
): Promise<void> {
  for (const { relation: name, ids } of references) {
    if (ids.length === 0) continue
    const relation = Model.$relationsDefinitions.get(name)!
    relation.boot()
    const RelatedModel = relation.relatedModel()
    const rows = await RelatedModel.query().whereIn(RelatedModel.primaryKey, ids)
    if (rows.length !== new Set(ids).size) {
      const found = new Set(rows.map((row) => String(row.$primaryKeyValue)))
      const missing = ids.filter((id) => !found.has(id))
      throw new JsonApiException(
        {
          title: 'Not Found',
          detail: `Related resources do not exist: ${missing.join(', ')}`,
          source: { pointer: `/data/relationships/${name}` },
        },
        { status: 404 }
      )
    }
  }
}
