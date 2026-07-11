/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

const ArticlesController = () => import('#controllers/articles_controller')
const ArticleRelationshipsController = () => import('#controllers/article_relationships_controller')

router.get('/', () => {
  return { hello: 'world' }
})

router
  .group(() => {
    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())

    router
      .group(() => {
        router.jsonApiResource('articles', {
          resource: ArticlesController,
          relationships: ArticleRelationshipsController,
        })
      })
      .as('jsonapi')
      .use(middleware.jsonApi())
  })
  .prefix('/api/v1')

/**
 * A second API version serving the same resources — link generation is
 * driven by the named routes of whichever group handled the request, so
 * v2 responses link to /api/v2/... URLs.
 */
router
  .group(() => {
    router.jsonApiResource('articles', {
      resource: ArticlesController,
      relationships: ArticleRelationshipsController,
    })
  })
  .prefix('/api/v2')
  .as('v2')
  .use(middleware.jsonApi())
