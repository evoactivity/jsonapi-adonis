import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path to the stubs directory, resolved from both the TypeScript
 * source (./stubs) and the compiled output (./build/stubs — the .stub files
 * are copied there by the build script).
 */
export const stubsRoot = dirname(fileURLToPath(import.meta.url))
