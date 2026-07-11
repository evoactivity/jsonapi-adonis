import Article from '#models/article'
import { JsonApiResource, filter } from 'jsonapi-adonis'

export default class ArticleResource extends JsonApiResource<Article> {
  static type = 'articles'
  static model = () => Article

  /**
   * Declared ?filter[...] parameters — nothing is filterable unless
   * listed here.
   */
  static filters = {
    // ?filter[title]=Hello (or comma-separated for whereIn)
    title: filter.eq(),

    // ?filter[publishedAfter]=2026-01-01 → where created_at >= …
    // (filter.gt / filter.lt / filter.lte work the same way)
    publishedAfter: filter.gte('createdAt'),
    publishedBefore: filter.lte('createdAt'),

    // ?filter[author]=1 → where author_id = 1
    author: filter.relation('author'),

    // ?filter[search]=json → title/body substring match
    search: filter.custom((query, value) => {
      query.where((q: any) => {
        q.whereILike('title', `%${value}%`).orWhereILike('body', `%${value}%`)
      })
    }),
  }
}
