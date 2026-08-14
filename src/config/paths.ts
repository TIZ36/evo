import { homedir } from 'node:os'
import { join } from 'node:path'

export type PathConfig = { dataDir?: string; databasePath?: string }
export type PathEnvironment = {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
}

export function resolveDataPaths(config: PathConfig = {}, runtime: PathEnvironment = {
  platform: process.platform,
  home: homedir(),
  env: process.env,
}) {
  if (config.databasePath) return { dataDir: config.dataDir, databasePath: config.databasePath }
  const dataDir = config.dataDir ?? runtime.env.EVO_MEMORY_DATA_DIR ?? platformDataDir(runtime)
  return { dataDir, databasePath: join(dataDir, 'memory.db') }
}

function platformDataDir(runtime: PathEnvironment): string {
  if (runtime.platform === 'darwin') return join(runtime.home, 'Library', 'Application Support', 'evo-memory')
  if (runtime.platform === 'win32') return join(runtime.env.APPDATA ?? join(runtime.home, 'AppData', 'Roaming'), 'evo-memory')
  return join(runtime.env.XDG_DATA_HOME ?? join(runtime.home, '.local', 'share'), 'evo-memory')
}
