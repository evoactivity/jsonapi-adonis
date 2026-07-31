import Article from '#models/article'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Demonstrates withPreloadScopes end to end: the article itself is
 * unconstrained, but its included comments are constrained to Comment's
 * `published` scope, at any depth they are requested.
 */
export default class PreloadScopesController {
  async show({ jsonApi, params }: HttpContext) {
    const article = await jsonApi
      .query(Article)
      .where('id', params.id)
      .withPreloadScopes({
        comments: (scopes) => scopes.published(),
      })
      .firstOrFail()

    return jsonApi.render(article)
  }
}
