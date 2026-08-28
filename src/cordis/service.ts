import { Service, type Context } from '@deepseek-ai/cordis'
import type { MemoryCandidate, MemoryQuery, MemoryScope, SkillItem, SkillQuery, Turn } from '../core/types.js'
import type { MemoryEventRecord, ModelRunner } from '../core/contracts.js'
import { EvoService } from '../core/evo.js'
import { SqliteMemoryStore } from '../storage/sqlite-store.js'
import { WorkspaceImporter, type WorkspaceImportResult } from '../workspace/importer.js'
import { buildScopeTree, type ScopeTreeNode } from '../core/scope-tree.js'
import { resolveDataPaths } from '../config/paths.js'
import type { Config } from './config.js'

export type SkillSummary = {
  name: string
  trigger: string
  path: string
  usageCount: number
  dormant: boolean
  promoted: boolean
  scope: MemoryScope
}

export type BacklogInfo = {
  replaySize: number
  scope: MemoryScope
}

function extractTriggerSummary(trigger: string, maxLen = 80): string {
  const firstLine = trigger.split('\n')[0] ?? trigger
  const cleaned = firstLine.replace(/^[-*]\s*/, '').trim()
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, maxLen - 3)}...`
}

declare module '@deepseek-ai/cordis' {
  interface Context { evo: EvoCordisService }
}

export type MemoryStatus = {
  ok: true
  databasePath: string
  /** True while a reflect/consolidate/workspace-import call is in flight. */
  busy: boolean
}

export class EvoCordisService extends Service {
  readonly core: EvoService
  readonly databasePath: string
  private readonly store: SqliteMemoryStore
  private workspace: WorkspaceImporter | undefined
  private busyCount = 0

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evo')
    this.databasePath = resolveDataPaths(config).databasePath
    this.store = new SqliteMemoryStore(this.databasePath)
    this.core = new EvoService({ store: this.store, skillStore: this.store, events: this.store })
    ctx.effect(() => () => this.store.close(), 'evo.close')
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

  async skills(query: SkillQuery = {}): Promise<SkillSummary[]> {
    const skills = await this.store.listSkills(query)
    return skills.map(skill => ({
      name: skill.name,
      trigger: extractTriggerSummary(skill.body.trigger),
      path: `.paper/agents/skills/${skill.name}`,
      usageCount: skill.usageCount,
      dormant: skill.dormant,
      promoted: skill.promoted,
      scope: skill.scope,
    }))
  }

  async backlog(scope: MemoryScope): Promise<BacklogInfo> {
    const replaySize = await this.store.countUnconsumedReplay(scope)
    return { replaySize, scope }
  }

  private async tracked<T>(fn: () => Promise<T>): Promise<T> {
    this.busyCount += 1
    try {
      return await fn()
    } finally {
      this.busyCount -= 1
    }
  }
}
