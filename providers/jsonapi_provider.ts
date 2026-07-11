import type { ApplicationService } from '@adonisjs/core/types'
import { HttpContext } from '@adonisjs/core/http'
import { JsonApiRegistry } from '../src/registry.ts'
import { JsonApiRequestContext } from '../src/context.ts'
import { defineConfig, type ResolvedJsonApiConfig } from '../src/define_config.ts'
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
