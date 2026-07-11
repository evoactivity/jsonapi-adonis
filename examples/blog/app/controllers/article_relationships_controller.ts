import Article from '#models/article'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * JSON:API relationship endpoints for articles:
 * https://jsonapi.org/format/#crud-updating-relationships
 */
export default class ArticleRelationshipsController {
  /**
   * GET /api/v1/articles/:id/relationships/:relation
   */
  async show({ jsonApi, params }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    return jsonApi.renderRelationship(article, params.relation)
  }

  /**
   * GET /api/v1/articles/:id/:relation — the `related` link target,
   * returning the related resources themselves.
   */
  async related({ jsonApi, params }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    return jsonApi.renderRelated(article, params.relation)
  }

  /**
   * PATCH — full replacement (to-one and to-many).
   */
  async replace({ jsonApi, params }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    return jsonApi.updateRelationship(article, params.relation, 'replace')
  }

  /**
   * POST — add members to a to-many relationship (no duplicates).
   */
  async add({ jsonApi, params }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    return jsonApi.updateRelationship(article, params.relation, 'add')
  }

  /**
   * DELETE — remove members from a to-many relationship.
   */
  async remove({ jsonApi, params }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    return jsonApi.updateRelationship(article, params.relation, 'remove')
  }
}
