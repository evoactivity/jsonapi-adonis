import { test } from '@japa/runner'
import {
  applyIncludes,
  preloadScopesFor,
  addPreloadScopes,
  type PreloadScope,
  type PreloadScopeTree,
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
  test('applies a bare-callback entry to a relation via withScopes', ({ assert }) => {
    const root = stubQuery()
    const tree: PreloadScopeTree = { comments: commentsScope }
    applyIncludes(anyQuery(root), { comments: {} }, Article, tree)
    root.runPreloads()

    assert.deepEqual(root.preloads.comments.calls, [['withScopes', commentsScope]])
  })

  test('descends preload to scope nested includes, typed per level', ({ assert }) => {
    const root = stubQuery()
    // structural: scope comments, and its nested author, by path
    const tree: PreloadScopeTree = {
      comments: { scope: commentsScope, preload: { author: authorScope } },
    }
    applyIncludes(anyQuery(root), { comments: { author: {} } }, Article, tree)
    root.runPreloads()

    assert.deepEqual(root.preloads.comments.calls, [['withScopes', commentsScope]])
    assert.deepEqual(root.preloads.comments.preloads.author.calls, [['withScopes', authorScope]])
  })

  test('an object entry with no scope only descends', ({ assert }) => {
    const root = stubQuery()
    const tree: PreloadScopeTree = { comments: { preload: { author: authorScope } } }
    applyIncludes(anyQuery(root), { comments: { author: {} } }, Article, tree)
    root.runPreloads()

    // comments itself is unscoped; only its nested author is scoped
    assert.deepEqual(root.preloads.comments.calls, [])
    assert.deepEqual(root.preloads.comments.preloads.author.calls, [['withScopes', authorScope]])
  })

  test('a relation with no entry is left untouched', ({ assert }) => {
    const root = stubQuery()
    applyIncludes(anyQuery(root), { comments: {}, tags: {} }, Article, {})
    root.runPreloads()

    assert.deepEqual(root.preloads.comments.calls, [])
    assert.deepEqual(root.preloads.tags.calls, [])
  })

  test('reads the tree at preload time, so scopes added after apply still count', ({ assert }) => {
    const root = stubQuery()
    const tree: PreloadScopeTree = {}
    // includes built first, with an empty tree — as jsonApi.query() does
    applyIncludes(anyQuery(root), { comments: {} }, Article, tree)
    // scope added afterwards — as a chained withPreloadScopes() would
    tree.comments = commentsScope
    root.runPreloads()

    assert.deepEqual(root.preloads.comments.calls, [['withScopes', commentsScope]])
  })
})

test.group('preload scope tree', () => {
  test('addPreloadScopes merges into the builder tree from preloadScopesFor', ({ assert }) => {
    // the real flow: query() calls preloadScopesFor once, the macro merges
    const builder = {}
    const tree = preloadScopesFor(builder)
    addPreloadScopes(builder, { comments: commentsScope })
    addPreloadScopes(builder, { author: authorScope })

    assert.deepEqual(tree, { comments: commentsScope, author: authorScope })
  })
})
