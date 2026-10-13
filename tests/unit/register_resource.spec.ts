/**
 * registerJsonApiResource turns a type plus one or two controllers into a set
 * of named routes. These tests drive it with a fake router that records the
 * route names, so they assert exactly which routes register for a given
 * selection without booting AdonisJS.
 *
 * `only` selects resource routes and `relationshipsOnly` selects relationship
 * routes. The two are independent: omit one and every route that controller
 * supports registers; pass it and only the listed actions register.
 */
import { test } from '@japa/runner'
import { registerJsonApiResource } from '../../src/routes.ts'
import type { JsonApiResourceOptions } from '../../src/routes.ts'

/**
 * A stand-in for the AdonisJS router that records the name of every route
 * registered through it, and the middleware attached to each route by
 * name. Only the four verbs registerJsonApiResource uses are implemented.
 */
function recordingRouter() {
  const names: string[] = []
  const middleware = new Map<string, string[]>()
  const record = () => {
    let routeName = ''
    const route = {
      as(name: string) {
        routeName = name
        names.push(name)
        return route
      },
      use(entry: string) {
        middleware.set(routeName, [...(middleware.get(routeName) ?? []), entry])
        return route
      },
    }
    return route
  }
  return {
    names,
    middleware,
    get: record,
    post: record,
    patch: record,
    delete: record,
  }
}

const lazyController = () => Promise.resolve({ default: class {} })

const controllers = {
  resource: lazyController,
  relationships: lazyController,
}

function registeredNames(options?: JsonApiResourceOptions): string[] {
  const router = recordingRouter()
  registerJsonApiResource(router, 'articles', controllers, options)
  return router.names
}

test.group('registerJsonApiResource route selection', () => {
  test('registers every resource and relationship route by default', ({ assert }) => {
    assert.deepEqual(registeredNames(), [
      'articles.index',
      'articles.store',
      'articles.show',
      'articles.update',
      'articles.destroy',
      'articles.relationships.show',
      'articles.relationships.replace',
      'articles.relationships.add',
      'articles.relationships.remove',
      'articles.related',
    ])
  })

  test('only selects resource routes and leaves relationship routes untouched', ({ assert }) => {
    assert.deepEqual(registeredNames({ only: ['index'] }), [
      'articles.index',
      'articles.relationships.show',
      'articles.relationships.replace',
      'articles.relationships.add',
      'articles.relationships.remove',
      'articles.related',
    ])
  })

  test('relationshipsOnly selects relationship routes and leaves resource routes untouched', ({
    assert,
  }) => {
    assert.deepEqual(registeredNames({ relationshipsOnly: ['show', 'related'] }), [
      'articles.index',
      'articles.store',
      'articles.show',
      'articles.update',
      'articles.destroy',
      'articles.relationships.show',
      'articles.related',
    ])
  })

  test('only and relationshipsOnly narrow both axes at once', ({ assert }) => {
    assert.deepEqual(registeredNames({ only: ['index'], relationshipsOnly: ['show'] }), [
      'articles.index',
      'articles.relationships.show',
    ])
  })

  test('registers no relationship routes when no relationships controller is given', ({
    assert,
  }) => {
    const router = recordingRouter()
    registerJsonApiResource(router, 'articles', { resource: lazyController })
    assert.deepEqual(router.names, [
      'articles.index',
      'articles.store',
      'articles.show',
      'articles.update',
      'articles.destroy',
    ])
  })

  test('registers no resource routes when no resource controller is given', ({ assert }) => {
    const router = recordingRouter()
    registerJsonApiResource(router, 'articles', { relationships: lazyController })
    assert.deepEqual(router.names, [
      'articles.relationships.show',
      'articles.relationships.replace',
      'articles.relationships.add',
      'articles.relationships.remove',
      'articles.related',
    ])
  })
})

test.group('registerJsonApiResource route middleware', () => {
  function middlewareOn(router: ReturnType<typeof recordingRouter>) {
    return Object.fromEntries(router.middleware)
  }

  test('use attaches middleware to the listed resource routes only', ({ assert }) => {
    const router = recordingRouter()
    registerJsonApiResource<string>(router, 'articles', controllers)
      .use(['show'], 'read')
      .use(['store', 'update'], 'write')

    assert.deepEqual(middlewareOn(router), {
      'articles.show': ['read'],
      'articles.store': ['write'],
      'articles.update': ['write'],
    })
  })

  test('use with * reaches every resource route and no relationship route', ({ assert }) => {
    const router = recordingRouter()
    registerJsonApiResource<string>(router, 'articles', controllers).use('*', 'auth')

    assert.deepEqual(Object.keys(middlewareOn(router)), [
      'articles.index',
      'articles.store',
      'articles.show',
      'articles.update',
      'articles.destroy',
    ])
  })

  test('useRelationships attaches to relationship routes, keeping show apart from the resource show', ({
    assert,
  }) => {
    const router = recordingRouter()
    registerJsonApiResource<string>(router, 'articles', controllers)
      .use(['show'], 'resource')
      .useRelationships(['show', 'replace'], 'relationship')

    assert.deepEqual(middlewareOn(router), {
      'articles.show': ['resource'],
      'articles.relationships.show': ['relationship'],
      'articles.relationships.replace': ['relationship'],
    })
  })

  test('naming an action that was not registered does nothing', ({ assert }) => {
    const router = recordingRouter()
    registerJsonApiResource<string>(router, 'articles', controllers, {
      only: ['index'],
      relationshipsOnly: ['show'],
    })
      .use(['destroy'], 'never')
      .useRelationships(['remove'], 'never')

    assert.deepEqual(middlewareOn(router), {})
  })

  test('middleware attached in several calls keeps its order on a route', ({ assert }) => {
    const router = recordingRouter()
    registerJsonApiResource<string>(router, 'articles', controllers)
      .use('*', 'first')
      .use(['show'], 'second')

    assert.deepEqual(router.middleware.get('articles.show'), ['first', 'second'])
  })
})
