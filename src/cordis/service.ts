import { Service, type Context } from '@deepseek-ai/cordis'
import { scopeKey, type MemoryCandidate, type MemoryQuery, type MemoryScope, type SkillItem, type SkillQuery, type Turn } from '../core/types.js'
import type { MemoryEventRecord, ModelRunner } from '../core/contracts.js'
import { EvoService } from '../core/evo.js'
import { SqliteMemoryStore } from '../storage/sqlite-store.js'
import { WorkspaceImporter, type WorkspaceImportResult } from '../workspace/importer.js'
import { SkillHydrator, type SkillHydrateResult } from '../workspace/skill-hydrator.js'
import { buildScopeTree, type ScopeTreeNode } from '../core/scope-tree.js'
import { resolveDataPaths } from '../config/paths.js'
import type { Config } from './config.js'
import { discoverGlobalSkillCatalog, discoverGlobalSkillFiles, discoverSkillCatalog, discoverSkillFiles, memoryItemToSummary, skillItemToSummary, type SkillSummary } from '../workspace/skill-discovery.js'

export type { SkillSummary } from '../workspace/skill-discovery.js'

export type BacklogInfo = {
  replaySize: number
  scope: MemoryScope
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
  private skillHydrator: SkillHydrator | undefined
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

  /**
   * Build context for model injection, including disk-discovered skills.
   * Pass `cwd` to include project-local skill directories.
   * Pass `includeGlobal: false` to exclude global (~/) skill directories.
   */
  context(query: MemoryQuery & { maxChars?: number; cwd?: string; includeGlobal?: boolean } = {}) {
    const additionalSkills = []
    if (query.cwd) {
      additionalSkills.push(...discoverSkillCatalog(query.cwd))
    }
    if (query.includeGlobal !== false) {
      additionalSkills.push(...discoverGlobalSkillCatalog())
    }
    return this.core.context({ ...query, additionalSkills })
  }

  forget(id: string) { return this.core.forget(id) }
  reflect(turn: Turn, signal?: AbortSignal) { return this.tracked(() => this.core.reflect(turn, signal)) }
  consolidate(scope: MemoryScope, signal?: AbortSignal) { return this.tracked(() => this.core.consolidate(scope, signal)) }
  setModelRunner(model: ModelRunner) { return this.core.setModelRunner(model) }
  async importWorkspace(cwd: string, options?: { force?: boolean }): Promise<WorkspaceImportResult & { skills?: SkillHydrateResult }> {
    this.workspace ??= new WorkspaceImporter(this.core.store)
    this.skillHydrator ??= new SkillHydrator(this.store)
    return this.tracked(async () => {
      const result = await this.workspace!.import(cwd, options)
      const skills = await this.skillHydrator!.hydrateProject(cwd, options)
      return { ...result, skills }
    })
  }

  /**
   * Hydrate global skills from $HOME directories into the skills table.
   */
  async hydrateGlobalSkills(options?: { force?: boolean }): Promise<SkillHydrateResult> {
    this.skillHydrator ??= new SkillHydrator(this.store)
    return this.tracked(() => this.skillHydrator!.hydrateGlobal(options))
  }
  events(limit = 50): Promise<MemoryEventRecord[]> { return this.store.listEvents(limit) }
  async scopes(): Promise<ScopeTreeNode[]> { return buildScopeTree(await this.store.countByScopeKey()) }
  status(): MemoryStatus { return { ok: true, databasePath: this.databasePath, busy: this.busyCount > 0 } }

  /**
   * List all skills from multiple sources:
   * 1. Skills table (evo-created skills)
   * 2. Memories with kind: 'skill' (human-written, imported)
   * 3. On-disk SKILL.md files not yet imported (hydrated on demand)
   *
   * Results are deduplicated by (scope_key, path) so same-named skills
   * in different directories both survive.
   */
  async skills(query: SkillQuery & { cwd?: string; includeGlobal?: boolean } = {}): Promise<SkillSummary[]> {
    const seenPaths = new Set<string>()
    const results: SkillSummary[] = []

    const skillQuery: SkillQuery = { ...query }
    const tableSkills = await this.core.listSkills(skillQuery)
    for (const skill of tableSkills) {
      const summary = skillItemToSummary(skill)
      const pathKey = `${scopeKey(summary.scope)}:${summary.path.toLowerCase()}`
      seenPaths.add(pathKey)
      results.push(summary)
    }

    const memoryQuery: MemoryQuery = { kinds: ['skill'], limit: query.limit ?? 200 }
    if (query.scopes?.length) memoryQuery.scopes = query.scopes
    if (query.text) memoryQuery.text = query.text
    const skillMemories = await this.core.recall(memoryQuery)
    for (const memory of skillMemories) {
      const summary = memoryItemToSummary(memory)
      if (!summary) continue
      const pathKey = `${scopeKey(summary.scope)}:${summary.path.toLowerCase()}`
      if (seenPaths.has(pathKey)) continue
      seenPaths.add(pathKey)
      results.push(summary)
    }

    if (query.cwd) {
      const projectScope: MemoryScope = { type: 'project', id: query.cwd }
      for (const { summary } of discoverSkillFiles(query.cwd, projectScope)) {
        const pathKey = `${scopeKey(summary.scope)}:${summary.path.toLowerCase()}`
        if (seenPaths.has(pathKey)) continue
        seenPaths.add(pathKey)
        results.push(summary)
      }
    }

    if (query.includeGlobal !== false) {
      for (const { summary } of discoverGlobalSkillFiles()) {
        const pathKey = `${scopeKey(summary.scope)}:${summary.path.toLowerCase()}`
        if (seenPaths.has(pathKey)) continue
        seenPaths.add(pathKey)
        results.push(summary)
      }
    }

    results.sort((a, b) => {
      if (a.dormant !== b.dormant) return a.dormant ? 1 : -1
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount
      return a.name.localeCompare(b.name)
    })

    return results.slice(0, query.limit ?? 200)
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
