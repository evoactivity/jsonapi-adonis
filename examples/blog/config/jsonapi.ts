import { defineConfig } from 'jsonapi-adonis'

export default defineConfig({
  /**
   * Resource classes customizing how models serialize. Models without a
   * resource class are auto-derived from Lucid metadata.
   */
  resources: [
    () => import('#resources/article_resource'),
    () => import('#resources/user_resource'),
  ],

  /**
   * Generate resource/relationship links from the named routes registered
   * via router.jsonApiResource(). Set to false to disable links entirely.
   */
  links: true,

  /**
   * Page size when the client paginates without an explicit page[size].
   */
  defaultPageSize: 20,

  /**
   * Accept client-generated ids on resource creation (403 when disabled).
   */
  allowClientIds: false,
})
