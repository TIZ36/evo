export * from './core/types.js'
export * from './core/contracts.js'
export * from './core/evo-memory.js'
export * from './core/json-model.js'
export * from './core/prompt.js'
export * from './config/paths.js'
export * from './storage/sqlite-store.js'
export * from './workspace/importer.js'
export { EvoMemoryCordisService } from './cordis/service.js'

/**
 * Bare-package plugin entry: a no-op host half that carries the web client
 * half (`exports["./client"]` + `dsh.client`). The DSH client-modules node
 * half only discovers `dsh.client` packages among enabled Loader entries whose
 * name resolves the bare package (subpath names like `evo-memory/cordis`
 * cannot resolve `<name>/package.json`), so the composition mounts this row
 * (`name: evo-memory`) purely as the client-bundle carrier.
 */
export const name = 'evo-memory'
export function apply(): void { /* web client carrier only */ }
