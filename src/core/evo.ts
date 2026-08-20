import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MemoryEventSink, MemoryStore, ModelRunner } from './contracts.js'
import { noopEventSink } from './contracts.js'
import { memoryKindSchema, memoryScopeSchema, scopeKey, type ConsolidationResult, type MemoryCandidate, type MemoryDelta, type MemoryItem, type MemoryQuery, type MemoryScope, type Turn } from './types.js'
import { parseModelJson } from './json-model.js'
import { consolidationPrompt, reflectionCap, reflectionPrompt, renderMemoryContext } from './prompt.js'

const candidateSchema = z.object({
  kind: memoryKindSchema,
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(4000),
  scope: memoryScopeSchema.optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  confidence: z.number().min(0).max(1).optional(),
})
const responseSchema = z.object({
  memories: z.array(candidateSchema).max(100),
  /** Titles the batch disproved. Absent from older reflectors, so it stays optional. */
  evict: z.array(z.string().min(1)).max(100).optional(),
})

/** Memories evo distilled itself — the only ones it may deduplicate against or evict.
    `evo-memory` is the name it wrote under before the package was renamed; stores
    predating the rename still hold those rows, and they are just as much its own. */
const OWN_RUNTIMES = new Set(['evo', 'evo-memory'])
const isOwn = (item: MemoryItem) => OWN_RUNTIMES.has(item.source?.runtime ?? '')

export type EvoOptions = {
  store: MemoryStore
  model?: ModelRunner
  events?: MemoryEventSink
  now?: () => number
  id?: () => string
}

export class EvoService {
  readonly store: MemoryStore
  private model: ModelRunner | undefined
  private readonly events: MemoryEventSink
  private readonly now: () => number
  private readonly id: () => string

  constructor(options: EvoOptions) {
    this.store = options.store; this.model = options.model; this.events = options.events ?? noopEventSink
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

  async context(query: MemoryQuery & { maxChars?: number } = {}) {
    return renderMemoryContext(await this.recall(query), query.maxChars)
  }

  async forget(id: string): Promise<void> {
    await this.store.delete(id); await this.events.emit({ type: 'memory.deleted', id })
  }

  /** One turn is a batch of one; the distilling rules are the same either way. */
  async reflect(turn: Turn, signal?: AbortSignal): Promise<MemoryDelta> {
    return this.reflectBatch([turn], signal)
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
   */
  async reflectBatch(turns: Turn[], signal?: AbortSignal): Promise<MemoryDelta> {
    const delta: MemoryDelta = { created: [], updated: [], deleted: [] }
    const first = turns[0]
    if (!first) return delta
    const model = this.requireModel()
    const scope = first.scope
    const existing = await this.store.list({ scopes: [scope], limit: 1000 })
    const own = existing.filter(isOwn)
    const prompt = reflectionPrompt(turns, { cap: reflectionCap(turns.length), existing: own.map(item => item.title) })
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
        await this.store.put(item); delta.updated.push(item); await this.events.emit({ type: 'memory.updated', item })
      } else {
        const item = await this.remember({ kind: candidate.kind, title: candidate.title, content: candidate.content, scope: at,
          ...(candidate.tags === undefined ? {} : { tags: candidate.tags }),
          ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }) })
        item.source = source
        await this.store.put(item); delta.created.push(item)
      }
    }

    for (const title of parsed.evict ?? []) {
      const doomed = own.find(item => item.title.toLocaleLowerCase() === title.trim().toLocaleLowerCase())
      /* A title the batch also rewrote is a correction, not a retraction: keep the new value. */
      if (!doomed || delta.updated.some(item => item.id === doomed.id) || delta.created.some(item => item.id === doomed.id)) continue
      await this.forget(doomed.id)
      delta.deleted.push(doomed.id)
    }

    await this.events.emit({ type: 'memory.reflected', turn: last, delta })
    return delta
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
