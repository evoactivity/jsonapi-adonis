import { test } from '@japa/runner'
import {
  applyIncludes,
  preloadScopesFor,
  addPreloadScopes,
  type PreloadScope,
  type PreloadScopeMap,
} from '../../src/query.ts'
import { Article } from '../fixtures/models.ts'

/**
 * Records withScopes calls and defers preload callbacks: preload() stores
 * the callback (as Lucid does) and runPreloads() invokes them, mirroring
 * Lucid running preload constraints at execution time. That lets a test
 * add scopes to the map after applyIncludes and still see them applied.
 */
interface StubQuery {
  calls: unknown[][]
  preloads: Record<string, StubQuery>
  withScopes(callback: PreloadScope): StubQuery
  preload(name: string, callback: (child: StubQuery) => void): StubQuery
  runPreloads(): void
}

function stubQuery(): StubQuery {
  const calls: unknown[][] = []
  const preloads: Record<string, StubQuery> = {}
  const pending: Record<string, (child: StubQuery) => void> = {}
  const query: StubQuery = {
    calls,
    preloads,
    withScopes(callback) {
      calls.push(['withScopes', callback])
      return query
    },
    preload(name, callback) {
      pending[name] = callback
      return query
    },
    runPreloads() {
      for (const [name, callback] of Object.entries(pending)) {
        const child = stubQuery()
        preloads[name] = child
        callback(child)
        child.runPreloads()
      }
    },
  }
  return query
}

function anyQuery(query: StubQuery) {
  return query as unknown as Parameters<typeof applyIncludes>[0]
}

const commentsScope: PreloadScope = (scopes) => {
  scopes.published()
}
const authorScope: PreloadScope = (scopes) => {
  scopes.active()
}

test.group('applyIncludes preload scopes', () => {
  test('applies the matching scope to a relation via withScopes', ({ assert }) => {
    const root = stubQuery()
    const map: PreloadScopeMap = { comments: commentsScope }
    applyIncludes(anyQuery(root), { comments: {} }, Article, map)
    root.runPreloads()

    assert.deepEqual(root.preloads.comments.calls, [['withScopes', commentsScope]])
  })

  test('applies scopes at any depth, keyed by relation name', ({ assert }) => {
    const root = stubQuery()
    const map: PreloadScopeMap = { author: authorScope }
    applyIncludes(anyQuery(root), { comments: { author: {} } }, Article, map)
    root.runPreloads()

    // comments has no scope in the map
    assert.deepEqual(root.preloads.comments.calls, [])
    // author, nested under comments, gets its scope
    assert.deepEqual(root.preloads.comments.preloads.author.calls, [['withScopes', authorScope]])
  })

  test('a relation with no scope is left untouched', ({ assert }) => {
    const root = stubQuery()
    applyIncludes(anyQuery(root), { comments: {}, tags: {} }, Article, {})
    root.runPreloads()

    assert.deepEqual(root.preloads.comments.calls, [])
    assert.deepEqual(root.preloads.tags.calls, [])
  })

  test('reads the map at preload time, so scopes added after apply still count', ({ assert }) => {
    const root = stubQuery()
    const map: PreloadScopeMap = {}
    // includes built first, with an empty map — as jsonApi.query() does
    applyIncludes(anyQuery(root), { comments: {} }, Article, map)
    // scope added afterwards — as a chained withPreloadScopes() would
    map.comments = commentsScope
    root.runPreloads()

    assert.deepEqual(root.preloads.comments.calls, [['withScopes', commentsScope]])
  })
})

test.group('preload scope map', () => {
  test('addPreloadScopes merges into the builder map from preloadScopesFor', ({ assert }) => {
    // the real flow: query() calls preloadScopesFor once, the macro merges
    const builder = {}
    const map = preloadScopesFor(builder)
    addPreloadScopes(builder, { comments: commentsScope })
    addPreloadScopes(builder, { author: authorScope })

    assert.deepEqual(map, { comments: commentsScope, author: authorScope })
  })
})
