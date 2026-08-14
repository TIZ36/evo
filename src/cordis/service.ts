import { Service, type Context } from '@deepseek-ai/cordis'
import type { MemoryCandidate, MemoryQuery, MemoryScope, Turn } from '../core/types.js'
import type { MemoryEventRecord, ModelRunner } from '../core/contracts.js'
import { EvoMemoryService } from '../core/evo-memory.js'
import { SqliteMemoryStore } from '../storage/sqlite-store.js'
import { WorkspaceImporter, type WorkspaceImportResult } from '../workspace/importer.js'
import { buildScopeTree, type ScopeTreeNode } from '../core/scope-tree.js'
import { resolveDataPaths } from '../config/paths.js'
import type { Config } from './config.js'

declare module '@deepseek-ai/cordis' {
  interface Context { evoMemory: EvoMemoryCordisService }
}

export type MemoryStatus = {
  ok: true
  databasePath: string
  /** True while a reflect/consolidate/workspace-import call is in flight. */
  busy: boolean
}

export class EvoMemoryCordisService extends Service {
  readonly core: EvoMemoryService
  readonly databasePath: string
  private readonly store: SqliteMemoryStore
  private workspace: WorkspaceImporter | undefined
  private busyCount = 0

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evoMemory')
    this.databasePath = resolveDataPaths(config).databasePath
    this.store = new SqliteMemoryStore(this.databasePath)
    this.core = new EvoMemoryService({ store: this.store, events: this.store })
    ctx.effect(() => () => this.store.close(), 'evoMemory.close')
  }

  remember(input: MemoryCandidate & { scope: MemoryScope }) { return this.core.remember(input) }
  recall(query: MemoryQuery = {}) { return this.core.recall(query) }
  get(id: string) { return this.core.store.get(id) }
  context(query: MemoryQuery & { maxChars?: number } = {}) { return this.core.context(query) }
  forget(id: string) { return this.core.forget(id) }
  reflect(turn: Turn, signal?: AbortSignal) { return this.tracked(() => this.core.reflect(turn, signal)) }
  consolidate(scope: MemoryScope, signal?: AbortSignal) { return this.tracked(() => this.core.consolidate(scope, signal)) }
  setModelRunner(model: ModelRunner) { return this.core.setModelRunner(model) }
  importWorkspace(cwd: string, options?: { force?: boolean }): Promise<WorkspaceImportResult> {
    this.workspace ??= new WorkspaceImporter(this.core.store)
    return this.tracked(() => this.workspace!.import(cwd, options))
  }
  events(limit = 50): Promise<MemoryEventRecord[]> { return this.store.listEvents(limit) }
  async scopes(): Promise<ScopeTreeNode[]> { return buildScopeTree(await this.store.countByScopeKey()) }
  status(): MemoryStatus { return { ok: true, databasePath: this.databasePath, busy: this.busyCount > 0 } }

  private async tracked<T>(fn: () => Promise<T>): Promise<T> {
    this.busyCount += 1
    try {
      return await fn()
    } finally {
      this.busyCount -= 1
    }
  }
}
