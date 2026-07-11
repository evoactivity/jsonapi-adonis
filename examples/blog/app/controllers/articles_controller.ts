import Article from '#models/article'
import { createArticleValidator, updateArticleValidator } from '#validators/article'
import type { HttpContext } from '@adonisjs/core/http'

export default class ArticlesController {
  /**
   * GET /api/v1/articles
   * Supports ?include=, ?fields[type]=, ?sort=, ?filter[...]=,
   * ?page[number]=, ?page[size]=
   */
  async index({ jsonApi }: HttpContext) {
    const articles = await jsonApi.query(Article).paginate(...jsonApi.page)
    return jsonApi.render(articles)
  }

  /**
   * GET /api/v1/articles/:id
   */
  async show({ jsonApi, params }: HttpContext) {
    const article = await jsonApi.query(Article).where('id', params.id).firstOrFail()
    return jsonApi.render(article)
  }

  /**
   * POST /api/v1/articles
   * Accepts a JSON:API resource document: attributes plus author (to-one →
   * foreign key) and tags (to-many, synced after save).
   */
  async store({ jsonApi }: HttpContext) {
    const input = await jsonApi.deserialize(Article)
    const payload = await createArticleValidator.validate(input.attributes)
    const article = await Article.create(payload)
    await jsonApi.syncToMany(article, input.toMany)
    return jsonApi.render(article, { status: 201 })
  }

  /**
   * PATCH /api/v1/articles/:id
   */
  async update({ jsonApi, params }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    const input = await jsonApi.deserialize(Article, { expectedId: String(article.id) })
    const payload = await updateArticleValidator.validate(input.attributes)
    article.merge(payload)
    await article.save()
    await jsonApi.syncToMany(article, input.toMany)
    return jsonApi.render(article)
  }

  /**
   * DELETE /api/v1/articles/:id
   */
  async destroy({ params, response }: HttpContext) {
    const article = await Article.findOrFail(params.id)
    await article.delete()
    return response.noContent()
  }
}
