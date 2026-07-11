import type { RouterContract } from '../../src/links.ts'

/**
 * A stand-in for the AdonisJS router that builds URLs from the
 * router.jsonApiResource() naming convention:
 *
 *   api.articles.show               → /api/articles/:id
 *   api.articles.relationships.show → /api/articles/:id/relationships/:relation
 *   api.articles.related            → /api/articles/:id/:relation
 *
 * Pass `existing` to restrict which route names resolve (mimicking
 * unregistered resources); omit it to treat every name as registered.
 */
export function stubRouter(existing?: string[]): RouterContract {
  return {
    find(identifier) {
      if (!existing) return {}
      return existing.includes(identifier) ? {} : null
    },
    makeUrl(identifier, params = {}) {
      const segments = identifier.split('.')
      const action = segments.pop()!
      const isRelationships = segments[segments.length - 1] === 'relationships'
      if (isRelationships) segments.pop()
      const type = segments.pop()!
      const prefix = segments.length ? `/${segments.join('/')}` : ''

      if (isRelationships) {
        return `${prefix}/${type}/${params.id}/relationships/${params.relation}`
      }
      if (action === 'related') {
        return `${prefix}/${type}/${params.id}/${params.relation}`
      }
      if (action === 'index' || action === 'store') {
        return `${prefix}/${type}`
      }
      return `${prefix}/${type}/${params.id}`
    },
  }
}
