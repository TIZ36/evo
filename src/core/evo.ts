import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MemoryEventSink, MemoryStore, ModelRunner, SkillStore } from './contracts.js'
import { noopEventSink } from './contracts.js'
import { memoryKindSchema, memoryScopeSchema, scopeKey, skillBodySchema, skillNameSchema, type ConsolidationResult, type MemoryCandidate, type MemoryDelta, type MemoryItem, type MemoryQuery, type MemoryScope, type SkillBody, type SkillCandidate, type SkillDelta, type SkillItem, type SkillLesson, type SkillQuery, type Turn } from './types.js'
import { parseModelJson } from './json-model.js'
import { consolidationPrompt, reflectionCap, reflectionPrompt, renderMemoryContext, type SkillCatalogEntry } from './prompt.js'

const candidateMemoryKindSchema = z.enum(['fact', 'preference', 'constraint', 'procedure'])
const candidateSchema = z.object({
  kind: candidateMemoryKindSchema,
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(4000),
  scope: memoryScopeSchema.optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  confidence: z.number().min(0).max(1).optional(),
})
const skillCandidateSchema = z.object({
  name: skillNameSchema,
  body: skillBodySchema,
}).nullable()
const responseSchema = z.object({
  memories: z.array(candidateSchema).max(100),
  /** Titles the batch disproved. Absent from older reflectors, so it stays optional. */
  evict: z.array(z.string().min(1)).max(100).optional(),
  /** One skill (or null) the batch may emit. */
  skill: skillCandidateSchema.optional(),
})

/** Memories evo distilled itself — the only ones it may deduplicate against or evict.
    `evo-memory` is the name it wrote under before the package was renamed; stores
    predating the rename still hold those rows, and they are just as much its own. */
const OWN_RUNTIMES = new Set(['evo', 'evo-memory'])
const isOwn = (item: MemoryItem) => OWN_RUNTIMES.has(item.source?.runtime ?? '')
const isOwnSkill = (item: SkillItem) => OWN_RUNTIMES.has(item.source?.runtime ?? '')

export type EvoOptions = {
  store: MemoryStore
  skillStore?: SkillStore
  model?: ModelRunner
  events?: MemoryEventSink
  now?: () => number
  id?: () => string
}

/** Result of a reflection that may include both memories and a skill. */
export type ReflectResult = {
  memories: MemoryDelta
  skill: SkillDelta
}

export class EvoService {
  readonly store: MemoryStore
  readonly skillStore: SkillStore | undefined
  private model: ModelRunner | undefined
  private readonly events: MemoryEventSink
  private readonly now: () => number
  private readonly id: () => string

  constructor(options: EvoOptions) {
    this.store = options.store; this.skillStore = options.skillStore; this.model = options.model; this.events = options.events ?? noopEventSink
    this.now = options.now ?? Date.now; this.id = options.id ?? randomUUID
  }

  async remember(input: MemoryCandidate & { scope: MemoryScope }): Promise<MemoryItem> {
    const now = this.now()
    const item: MemoryItem = { id: this.id(), scope: input.scope, kind: input.kind, title: input.title.trim(),
      content: input.content.trim(), tags: input.tags ?? [], usageCount: 0, createdAt: now, updatedAt: now,
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }) }
    await this.store.put(item); await this.events.emit({ type: 'memory.created', item })
    return item
  }

  recall(query: MemoryQuery = {}) { return this.store.list(query) }

  setModelRunner(model: ModelRunner): () => void {
    const previous = this.model
    this.model = model
    return () => { if (this.model === model) this.model = previous }
  }

  /**
   * Build the recalled context for model injection.
   *
   * Memories are rendered inline. Skills are listed as catalog entries (name +
   * trigger + path) — the model can Read the SKILL.md if needed.
   */
  async context(query: MemoryQuery & { maxChars?: number; skillRoot?: string } = {}) {
    const memories = await this.recall(query)
    const skillEntries: SkillCatalogEntry[] = []
    if (this.skillStore && query.scopes?.length) {
      const skillQuery: SkillQuery = { scopes: query.scopes }
      if (query.limit !== undefined) skillQuery.limit = query.limit
      const skills = await this.skillStore.listSkills(skillQuery)
      for (const skill of skills) {
        skillEntries.push({
          name: skill.name,
          trigger: extractTriggerSummary(skill.body.trigger),
          path: query.skillRoot ? `${query.skillRoot}/${skill.name}` : `.paper/agents/skills/${skill.name}`,
        })
      }
    }
    return renderMemoryContext(memories, skillEntries, query.maxChars)
  }

  async forget(id: string): Promise<void> {
    await this.store.delete(id); await this.events.emit({ type: 'memory.deleted', id })
  }

  /** One turn is a batch of one; the distilling rules are the same either way. */
  async reflect(turn: Turn, signal?: AbortSignal): Promise<MemoryDelta> {
    const result = await this.reflectBatch([turn], signal)
    return result.memories
  }

  /**
   * Distil a batch of turns in a single model call.
   *
   * The reflector is told what this scope already stores and how many memories
   * it may return, because neither is knowable from the turns alone: without
   * the stored titles it renames yesterday's fact into a new row, and without a
   * cap it quotes a long answer back as eight durable memories.
   *
   * Only memories evo itself distilled take part. Imported workspace files are
   * a projection of what is on disk — evo neither deduplicates against them nor
   * lets a model evict them, or one reflection could delete the user's rules.
   *
   * Returns both memory delta and skill delta. A skill is emitted at most once
   * per batch — it is a rarer asset than a memory.
   */
  async reflectBatch(turns: Turn[], signal?: AbortSignal): Promise<ReflectResult> {
    const memoryDelta: MemoryDelta = { created: [], updated: [], deleted: [] }
    const skillDelta: SkillDelta = { created: null, updated: null }
    const first = turns[0]
    if (!first) return { memories: memoryDelta, skill: skillDelta }
    const model = this.requireModel()
    const scope = first.scope
    const existing = await this.store.list({ scopes: [scope], limit: 1000 })
    const own = existing.filter(isOwn)
    const existingSkills = this.skillStore ? (await this.skillStore.listSkills({ scopes: [scope], limit: 1000 })).filter(isOwnSkill) : []
    const prompt = reflectionPrompt(turns, {
      cap: reflectionCap(turns.length),
      existing: own.map(item => item.title),
      existingSkills: existingSkills.map(item => item.name),
    })
    const parsed = responseSchema.parse(parseModelJson(await model.complete({ purpose: 'reflect', prompt, ...(signal ? { signal } : {}) })))
    const last = turns[turns.length - 1]!
    const source = { runtime: 'evo', sessionId: last.sessionId, turn: last.turn }

    for (const candidate of parsed.memories.slice(0, reflectionCap(turns.length))) {
      const at = candidate.scope ?? scope
      const old = existing.find(item => scopeKey(item.scope) === scopeKey(at) && item.title.toLocaleLowerCase() === candidate.title.toLocaleLowerCase())
      const now = this.now()
      if (old) {
        const item: MemoryItem = { ...old, kind: candidate.kind, content: candidate.content, tags: candidate.tags ?? old.tags,
          updatedAt: now, source,
          ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }) }
        await this.store.put(item); memoryDelta.updated.push(item); await this.events.emit({ type: 'memory.updated', item })
      } else {
        const item = await this.remember({ kind: candidate.kind, title: candidate.title, content: candidate.content, scope: at,
          ...(candidate.tags === undefined ? {} : { tags: candidate.tags }),
          ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }) })
        item.source = source
        await this.store.put(item); memoryDelta.created.push(item)
      }
    }

    for (const title of parsed.evict ?? []) {
      const doomed = own.find(item => item.title.toLocaleLowerCase() === title.trim().toLocaleLowerCase())
      if (!doomed || memoryDelta.updated.some(item => item.id === doomed.id) || memoryDelta.created.some(item => item.id === doomed.id)) continue
      await this.forget(doomed.id)
      memoryDelta.deleted.push(doomed.id)
    }

    if (parsed.skill && this.skillStore) {
      const now = this.now()
      const oldSkill = existingSkills.find(item => item.name === parsed.skill!.name)
      if (oldSkill) {
        const item: SkillItem = { ...oldSkill, body: parsed.skill.body, updatedAt: now, source }
        await this.skillStore.putSkill(item)
        skillDelta.updated = item
        await this.events.emit({ type: 'skill.updated', skill: item })
      } else {
        const item: SkillItem = { name: parsed.skill.name, scope, body: parsed.skill.body, usageCount: 0, createdAt: now, updatedAt: now, source }
        await this.skillStore.putSkill(item)
        skillDelta.created = item
        await this.events.emit({ type: 'skill.created', skill: item })
      }
    }

    await this.events.emit({ type: 'memory.reflected', turn: last, delta: memoryDelta })
    return { memories: memoryDelta, skill: skillDelta }
  }

  // ── Skill methods ─────────────────────────────────────────────────────────────

  /** List skills in the given scopes. */
  async listSkills(query: SkillQuery = {}): Promise<SkillItem[]> {
    if (!this.skillStore) return []
    return this.skillStore.listSkills(query)
  }

  /** Record that a skill was used, optionally adding a lesson. */
  async useSkill(scope: MemoryScope, name: string, lesson?: string): Promise<void> {
    if (!this.skillStore) return
    await this.skillStore.incrementUsage(scope, name)
    if (lesson) {
      const lessonItem: SkillLesson = { text: lesson.trim(), createdAt: this.now() }
      await this.skillStore.addLesson(scope, name, lessonItem)
      await this.events.emit({ type: 'skill.used', scope, name, lesson })
    } else {
      await this.events.emit({ type: 'skill.used', scope, name })
    }
  }

  /** Get lessons for a skill. */
  async getLessons(scope: MemoryScope, name: string): Promise<SkillLesson[]> {
    if (!this.skillStore) return []
    return this.skillStore.getLessons(scope, name)
  }

  async consolidate(scope: MemoryScope, signal?: AbortSignal): Promise<ConsolidationResult> {
    const before = await this.store.list({ scopes: [scope], limit: 1000 })
    if (!before.length) return { before: 0, after: 0, items: [] }
    const parsed = responseSchema.parse(parseModelJson(await this.requireModel().complete({ purpose: 'consolidate', prompt: consolidationPrompt(before), ...(signal ? { signal } : {}) })))
    if (!parsed.memories.length) throw new Error('consolidation returned an empty memory set; original memories preserved')
    const now = this.now()
    const items = parsed.memories.map((candidate): MemoryItem => ({ id: this.id(), scope, kind: candidate.kind,
      title: candidate.title, content: candidate.content, tags: candidate.tags ?? [], usageCount: 0,
      createdAt: now, updatedAt: now, ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }) }))
    await this.store.replace(scope, items)
    const result = { before: before.length, after: items.length, items }
    await this.events.emit({ type: 'memory.consolidated', scope, result })
    return result
  }

  private requireModel(): ModelRunner {
    if (!this.model) throw new Error('reflect and consolidate require a ModelRunner')
    return this.model
  }
}

function extractTriggerSummary(trigger: string, maxLen = 80): string {
  const firstLine = trigger.split('\n')[0] ?? trigger
  const cleaned = firstLine.replace(/^[-*]\s*/, '').trim()
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, maxLen - 3)}...`
}
