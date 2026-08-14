import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MemoryEventSink, MemoryStore, ModelRunner } from './contracts.js'
import { noopEventSink } from './contracts.js'
import { memoryKindSchema, memoryScopeSchema, scopeKey, type ConsolidationResult, type MemoryCandidate, type MemoryDelta, type MemoryItem, type MemoryQuery, type MemoryScope, type Turn } from './types.js'
import { parseModelJson } from './json-model.js'
import { consolidationPrompt, reflectionPrompt, renderMemoryContext } from './prompt.js'

const candidateSchema = z.object({
  kind: memoryKindSchema,
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(4000),
  scope: memoryScopeSchema.optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  confidence: z.number().min(0).max(1).optional(),
})
const responseSchema = z.object({ memories: z.array(candidateSchema).max(100) })

export type EvoMemoryOptions = {
  store: MemoryStore
  model?: ModelRunner
  events?: MemoryEventSink
  now?: () => number
  id?: () => string
}

export class EvoMemoryService {
  readonly store: MemoryStore
  private model: ModelRunner | undefined
  private readonly events: MemoryEventSink
  private readonly now: () => number
  private readonly id: () => string

  constructor(options: EvoMemoryOptions) {
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

  async reflect(turn: Turn, signal?: AbortSignal): Promise<MemoryDelta> {
    const model = this.requireModel()
    const parsed = responseSchema.parse(parseModelJson(await model.complete({ purpose: 'reflect', prompt: reflectionPrompt(turn), ...(signal ? { signal } : {}) })))
    const existing = await this.store.list({ scopes: [turn.scope], limit: 1000 })
    const delta: MemoryDelta = { created: [], updated: [], deleted: [] }
    for (const candidate of parsed.memories) {
      const scope = candidate.scope ?? turn.scope
      const old = existing.find(item => scopeKey(item.scope) === scopeKey(scope) && item.title.toLocaleLowerCase() === candidate.title.toLocaleLowerCase())
      const now = this.now()
      if (old) {
        const item: MemoryItem = { ...old, kind: candidate.kind, content: candidate.content, tags: candidate.tags ?? old.tags,
          updatedAt: now, source: { runtime: 'evo-memory', sessionId: turn.sessionId, turn: turn.turn },
          ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }) }
        await this.store.put(item); delta.updated.push(item); await this.events.emit({ type: 'memory.updated', item })
      } else {
        const item = await this.remember({ kind: candidate.kind, title: candidate.title, content: candidate.content, scope,
          ...(candidate.tags === undefined ? {} : { tags: candidate.tags }),
          ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }) })
        item.source = { runtime: 'evo-memory', sessionId: turn.sessionId, turn: turn.turn }
        await this.store.put(item); delta.created.push(item)
      }
    }
    await this.events.emit({ type: 'memory.reflected', turn, delta })
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
