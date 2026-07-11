import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.ts'

/**
 * Invoked by `node ace add jsonapi-adonis` (or `node ace configure
 * jsonapi-adonis`). Publishes config/jsonapi.ts, registers the provider and
 * the `jsonApi` named middleware.
 */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.makeUsingStub(stubsRoot, 'config/jsonapi.stub', {})

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('jsonapi-adonis/provider')
    rcFile.addCommand('jsonapi-adonis/commands')
  })

  await codemods.registerMiddleware('named', [
    { name: 'jsonApi', path: 'jsonapi-adonis/middleware' },
  ])
}
