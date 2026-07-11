import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import {
  DocumentBuilder,
  JsonApiRegistry,
  LinkBuilder,
  applyIncludes,
  parseQueryParams,
  validateIncludeTree,
  type DynamicModelQuery,
} from 'jsonapi-adonis'

/**
 * Serializes articles into a JSON:API document without any HTTP request —
 * the same building blocks the ctx.jsonApi helper composes, driven by hand.
 * See docs/low-level.md in the jsonapi-adonis repository.
 */
export default class ExportArticles extends BaseCommand {
  static commandName = 'export:articles'
  static description = 'Export all articles as a JSON:API document to stdout'

  /**
   * Boot the full application: the database and the provider-registered
   * resource classes are needed.
   */
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'Include paths (same syntax as ?include=)', default: 'author' })
  declare include: string

  async run() {
    const { default: Article } = await import('#models/article')

    /** The same registry the HTTP layer uses, resolved from the container */
    const registry = await this.app.container.make(JsonApiRegistry)

    /** Reuse the query-parameter machinery for include parsing/validation */
    const params = parseQueryParams({ include: this.include })
    validateIncludeTree(Article, params.include)

    const query = Article.query()
    // Same variance bridge ctx.jsonApi.query() uses: Lucid types preload()
    // with literal relation names; the include tree works with strings
    applyIncludes(query as unknown as DynamicModelQuery, params.include)
    const articles = await query

    /** No request → no route namespace, so link generation is off */
    const document = new DocumentBuilder(registry, params, new LinkBuilder(false)).build(articles)

    this.logger.log(JSON.stringify(document, null, 2))
  }
}
