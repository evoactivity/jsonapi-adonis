import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.ts'

/**
 * Invoked by `node ace add @evoactivity/jsonapi-adonis` (or `node ace configure
 * @evoactivity/jsonapi-adonis`). Publishes config/jsonapi.ts, registers the provider and
 * the `jsonApi` named middleware.
 */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.makeUsingStub(stubsRoot, 'config/jsonapi.stub', {})

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@evoactivity/jsonapi-adonis/provider')
    rcFile.addCommand('@evoactivity/jsonapi-adonis/commands')
  })

  await codemods.registerMiddleware('named', [
    { name: 'jsonApi', path: '@evoactivity/jsonapi-adonis/middleware' },
  ])
}
