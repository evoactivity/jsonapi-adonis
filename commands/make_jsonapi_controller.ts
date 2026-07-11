import { args, flags, BaseCommand } from '@adonisjs/core/ace'
import { stubsRoot } from '../stubs/main.ts'
import { appendRoutes, buildStubState, routeRegistration } from './scaffolding.ts'

/**
 * Scaffolds JSON:API controllers only — for models that rely on the
 * auto-derived resource and need no resource class:
 *
 * ```sh
 * node ace make:jsonapi:controller comment                  # resource controller
 * node ace make:jsonapi:controller comment --relationships  # + relationship controller
 * node ace make:jsonapi:controller comment --routes         # also register routes
 * ```
 */
export default class MakeJsonApiController extends BaseCommand {
  static commandName = 'make:jsonapi:controller'
  static description = 'Create JSON:API controllers for a model that uses the auto-derived resource'

  @args.string({ description: 'Name of the model the controllers serve (e.g. "comment")' })
  declare name: string

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

    await codemods.makeUsingStub(stubsRoot, 'make/controller.stub', state)
    if (this.relationships) {
      await codemods.makeUsingStub(stubsRoot, 'make/relationships_controller.stub', state)
    }
    if (this.routes) {
      await appendRoutes(this, state, this.relationships)
    }

    if (!this.routes) {
      this.logger.log('')
      this.logger.info(`Register routes (or re-run with --routes):`)
      this.logger.log(routeRegistration(state, this.relationships, '  '))
    }
  }
}
