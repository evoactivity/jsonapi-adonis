import { args, flags, BaseCommand } from '@adonisjs/core/ace'
import { stubsRoot } from '../stubs/main.ts'
import { appendRoutes, buildStubState, routeRegistration } from './scaffolding.ts'

/**
 * Scaffolds a JSON:API resource class and its controllers:
 *
 * ```sh
 * node ace make:jsonapi:resource article                  # resource + controller
 * node ace make:jsonapi:resource article --relationships  # + relationship controller
 * node ace make:jsonapi:resource article --no-controller  # resource only
 * node ace make:jsonapi:resource article --routes         # also register routes
 * ```
 */
export default class MakeJsonApiResource extends BaseCommand {
  static commandName = 'make:jsonapi:resource'
  static description =
    'Create a JSON:API resource class, with optional resource and relationship controllers'

  @args.string({ description: 'Name of the model the resource serializes (e.g. "article")' })
  declare name: string

  @flags.boolean({
    description: 'Generate the resource controller',
    default: true,
    showNegatedVariantInHelp: true,
  })
  declare controller: boolean

  @flags.boolean({
    description: 'Also generate the relationship-endpoints controller',
    alias: 'r',
  })
  declare relationships: boolean

  @flags.boolean({ description: 'Append the route registration to start/routes.ts' })
  declare routes: boolean

  @flags.boolean({ description: 'Forcefully overwrite existing files', alias: 'f' })
  declare force: boolean

  async run() {
    const codemods = await this.createCodemods()
    codemods.overwriteExisting = this.force === true
    const state = buildStubState(this, this.name)

    await codemods.makeUsingStub(stubsRoot, 'make/resource.stub', state)

    if (this.controller) {
      await codemods.makeUsingStub(stubsRoot, 'make/controller.stub', state)
    }
    if (this.relationships) {
      await codemods.makeUsingStub(stubsRoot, 'make/relationships_controller.stub', state)
    }
    if (this.routes && this.controller) {
      await appendRoutes(this, state, this.relationships)
    }

    this.logger.log('')
    const resourceImport = `() => import('#resources/${state.resourceFileName.replace(/\.ts$/, '')}')`
    this.logger.info(`Register the resource in config/jsonapi.ts:  resources: [${resourceImport}]`)
    if (this.controller && !this.routes) {
      this.logger.info(`Register routes (or re-run with --routes):`)
      this.logger.log(routeRegistration(state, this.relationships, '  '))
    }
  }
}
