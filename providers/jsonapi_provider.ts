import type { ApplicationService } from '@adonisjs/core/types'
import { HttpContext } from '@adonisjs/core/http'
import { ModelQueryBuilder } from '@adonisjs/lucid/orm'
import { JsonApiRegistry } from '../src/registry.ts'
import { JsonApiRequestContext } from '../src/context.ts'
import { defineConfig, type ResolvedJsonApiConfig } from '../src/define_config.ts'
import { addPreloadScopes, type PreloadScopeMap, type PreloadScopeTree } from '../src/query.ts'
import {
  registerJsonApiResource,
  type JsonApiResourceControllers,
  type JsonApiResourceOptions,
} from '../src/routes.ts'

/**
 * Registers the JSON:API integration:
 *
 * - `ctx.jsonApi` request helper (serialization, deserialization, query
 *   building, relationship operations)
 * - `router.jsonApiResource()` macro for registering conventionally named
 *   resource routes that drive link generation
 * - resource classes listed in `config/jsonapi.ts`
 * - the configured `JsonApiRegistry` as a container singleton, so code
 *   outside a request (commands, jobs, tests) can resolve the same registry:
 *   `await app.container.make(JsonApiRegistry)`
 */
export default class JsonApiProvider {
  #registry = new JsonApiRegistry()

  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(JsonApiRegistry, () => this.#registry)
  }

  async boot() {
    const config = this.app.config.get<ResolvedJsonApiConfig>('jsonapi', defineConfig({}))
    const registry = this.#registry
    const router = await this.app.container.make('router')

    HttpContext.getter(
      'jsonApi',
      function (this: HttpContext) {
        return new JsonApiRequestContext(this, registry, config, router)
      },
      true
    )

    router.jsonApiResource = function (
      type: string,
      controllers: JsonApiResourceControllers,
      options?: JsonApiResourceOptions
    ) {
      registerJsonApiResource(this, type, controllers, options)
    }

    /**
     * Constrains the preload query of included relations, keyed by relation
     * name and applied at any depth. Chains after jsonApi.query() and
     * composes with Lucid's own withScopes() (which handles the root):
     *
     * ```ts
     * await jsonApi
     *   .query(Article)
     *   .withScopes((s) => s.published())
     *   .withPreloadScopes({ comments: (s) => s.published() })
     * ```
     */
    ModelQueryBuilder.macro(
      'withPreloadScopes',
      function (this: ModelQueryBuilder, scopes: PreloadScopeTree) {
        addPreloadScopes(this, scopes)
        return this
      }
    )
  }

  /**
   * Resource classes import Lucid models, which must not happen before the
   * application is fully booted (importing models during provider boot can
   * capture uninitialized services, e.g. hash in auth mixins).
   */
  async ready() {
    const config = this.app.config.get<ResolvedJsonApiConfig>('jsonapi', defineConfig({}))
    for (const lazyImport of config.resources ?? []) {
      const { default: resource } = await lazyImport()
      this.#registry.register([resource])
    }
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    jsonApi: JsonApiRequestContext
  }
}

declare module '@adonisjs/core/types' {
  export interface HttpRouterService {
    jsonApiResource(
      type: string,
      controllers: JsonApiResourceControllers,
      options?: JsonApiResourceOptions
    ): void
  }
}

/**
 * Two augmentations: the contract is what callers hold off jsonApi.query()
 * and Lucid's chainable methods, so they need the method there; the
 * concrete class is what Macroable.macro() keys off (name must be a key of
 * the instance type), so registering the macro needs it there too.
 */
declare module '@adonisjs/lucid/types/model' {
  interface ModelQueryBuilderContract<Model extends LucidModel, Result = InstanceType<Model>> {
    withPreloadScopes(scopes: PreloadScopeMap<Model>): this
  }
}

declare module '@adonisjs/lucid/orm' {
  interface ModelQueryBuilder {
    withPreloadScopes(scopes: PreloadScopeTree): this
  }
}
