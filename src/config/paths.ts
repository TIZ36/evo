import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type PathConfig = { dataDir?: string; databasePath?: string }
export type PathEnvironment = {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  /** Existence probe, injected for tests. */
  exists?: (path: string) => boolean
}

/** Directory name before the package was renamed from `evo-memory` to `evo`. */
const LEGACY_DIR_NAME = 'evo-memory'
const DIR_NAME = 'evo'
const DATABASE_FILE = 'memory.db'

export function resolveDataPaths(config: PathConfig = {}, runtime: PathEnvironment = {
  platform: process.platform,
  home: homedir(),
  env: process.env,
}) {
  if (config.databasePath) return { dataDir: config.dataDir, databasePath: config.databasePath }
  const configured = config.dataDir ?? runtime.env.EVO_DATA_DIR ?? runtime.env.EVO_MEMORY_DATA_DIR
  if (configured) return { dataDir: configured, databasePath: join(configured, DATABASE_FILE) }
  const dataDir = platformDataDir(runtime, DIR_NAME)
  const exists = runtime.exists ?? existsSync
  // Pre-rename installs keep their database in the `evo-memory` directory;
  // adopt it instead of silently starting from an empty store.
  if (!exists(join(dataDir, DATABASE_FILE))) {
    const legacyDir = platformDataDir(runtime, LEGACY_DIR_NAME)
    if (exists(join(legacyDir, DATABASE_FILE))) return { dataDir: legacyDir, databasePath: join(legacyDir, DATABASE_FILE) }
  }
  return { dataDir, databasePath: join(dataDir, DATABASE_FILE) }
}

function platformDataDir(runtime: PathEnvironment, name: string): string {
  if (runtime.platform === 'darwin') return join(runtime.home, 'Library', 'Application Support', name)
  if (runtime.platform === 'win32') return join(runtime.env.APPDATA ?? join(runtime.home, 'AppData', 'Roaming'), name)
  return join(runtime.env.XDG_DATA_HOME ?? join(runtime.home, '.local', 'share'), name)
}
