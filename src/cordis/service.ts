import { Service, type Context } from '@deepseek-ai/cordis'
import type { MemoryCandidate, MemoryQuery, MemoryScope, Turn } from '../core/types.js'
import type { ModelRunner } from '../core/contracts.js'
import { EvoMemoryService } from '../core/evo-memory.js'
import { SqliteMemoryStore } from '../storage/sqlite-store.js'
import { resolveDataPaths } from '../config/paths.js'
import type { Config } from './config.js'

declare module '@deepseek-ai/cordis' {
  interface Context { evoMemory: EvoMemoryCordisService }
}

export class EvoMemoryCordisService extends Service {
  readonly core: EvoMemoryService
  readonly databasePath: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evoMemory')
    this.databasePath = resolveDataPaths(config).databasePath
    const store = new SqliteMemoryStore(this.databasePath)
    this.core = new EvoMemoryService({ store })
    ctx.effect(() => () => store.close(), 'evoMemory.close')
  }

  remember(input: MemoryCandidate & { scope: MemoryScope }) { return this.core.remember(input) }
  recall(query: MemoryQuery = {}) { return this.core.recall(query) }
  context(query: MemoryQuery & { maxChars?: number } = {}) { return this.core.context(query) }
  forget(id: string) { return this.core.forget(id) }
  reflect(turn: Turn, signal?: AbortSignal) { return this.core.reflect(turn, signal) }
  consolidate(scope: MemoryScope, signal?: AbortSignal) { return this.core.consolidate(scope, signal) }
  setModelRunner(model: ModelRunner) { return this.core.setModelRunner(model) }
}
