import { ListLoader } from '@adonisjs/core/ace'
import type { CommandMetaData } from '@adonisjs/core/types/ace'
import MakeJsonApiResource from './make_jsonapi_resource.ts'
import MakeJsonApiController from './make_jsonapi_controller.ts'

/**
 * Ace command loader for @evoactivity/jsonapi-adonis. Registered in consumer apps as:
 *
 * ```ts
 * // adonisrc.ts
 * commands: [() => import('@evoactivity/jsonapi-adonis/commands')]
 * ```
 */
const loader = new ListLoader([MakeJsonApiResource, MakeJsonApiController])

export function getMetaData() {
  return loader.getMetaData()
}

export function getCommand(metaData: CommandMetaData) {
  return loader.getCommand(metaData)
}
