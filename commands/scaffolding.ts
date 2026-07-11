import { readFile, writeFile } from 'node:fs/promises'
import string from '@adonisjs/core/helpers/string'
import type { BaseCommand } from '@adonisjs/core/ace'

/**
 * Shared state for the make:jsonapi:* stubs, derived from the entity name.
 */
export function buildStubState(command: BaseCommand, name: string) {
  const entity = command.app.generators.createEntity(name)
  const modelName = command.app.generators.modelName(entity.name)
  return {
    entity,
    modelName,
    modelFileName: command.app.generators.modelFileName(entity.name),
    resourceName: `${modelName}Resource`,
    resourceFileName: `${string.snakeCase(modelName)}_resource.ts`,
    controllerName: command.app.generators.controllerName(entity.name),
    controllerFileName: command.app.generators.controllerFileName(entity.name),
    relationshipsControllerName: `${modelName}RelationshipsController`,
    relationshipsControllerFileName: `${string.snakeCase(modelName)}_relationships_controller.ts`,
    type: string.dashCase(string.plural(entity.name)),
  }
}

export type StubState = ReturnType<typeof buildStubState>

/**
 * The `router.jsonApiResource(...)` registration for the generated
 * controllers, used both for the --routes append and the printed snippet.
 */
export function routeRegistration(state: StubState, relationships: boolean, indent = ''): string {
  const controllerImport = `#controllers/${state.controllerFileName.replace(/\.ts$/, '')}`
  const lines = [
    `${indent}router.jsonApiResource('${state.type}', {`,
    `${indent}  resource: () => import('${controllerImport}'),`,
  ]
  if (relationships) {
    const relationshipsImport = `#controllers/${state.relationshipsControllerFileName.replace(/\.ts$/, '')}`
    lines.push(`${indent}  relationships: () => import('${relationshipsImport}'),`)
  }
  lines.push(`${indent}})`)
  return lines.join('\n')
}

/**
 * Appends a route-group registration to start/routes.ts. Skips (with a
 * warning) when the type is already registered, and adds the router import
 * if the file somehow lacks it.
 */
export async function appendRoutes(
  command: BaseCommand,
  state: StubState,
  relationships: boolean
): Promise<void> {
  const routesFile = command.app.makePath('start/routes.ts')
  let contents: string
  try {
    contents = await readFile(routesFile, 'utf8')
  } catch {
    command.logger.warning(`Could not read start/routes.ts — register the routes manually`)
    return
  }

  if (contents.includes(`jsonApiResource('${state.type}'`)) {
    command.logger.warning(
      `start/routes.ts already registers '${state.type}' — skipped adding routes`
    )
    return
  }

  const commandName = (command.constructor as typeof BaseCommand).commandName
  const hasMiddleware = contents.includes(`from '#start/kernel'`)
  const group = [
    '',
    `// Added by ${commandName} — move into your API route group if you have one`,
    'router',
    '  .group(() => {',
    routeRegistration(state, relationships, '    '),
    '  })',
    ...(hasMiddleware ? ['  .use(middleware.jsonApi())'] : []),
    '',
  ].join('\n')

  if (!contents.includes(`from '@adonisjs/core/services/router'`)) {
    contents = `import router from '@adonisjs/core/services/router'\n${contents}`
  }

  await writeFile(routesFile, `${contents}${group}`)
  command.logger.action('update start/routes.ts').succeeded()
  if (!hasMiddleware) {
    command.logger.warning(
      'Could not detect the middleware import — add .use(middleware.jsonApi()) to the group yourself'
    )
  }
}
