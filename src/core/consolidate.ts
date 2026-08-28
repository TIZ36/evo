import { createHash } from 'node:crypto'
import type { ConsolidationStore, MemoryStore, ModelRunner, ReplayStore } from './contracts.js'
import type { ConsolidationResult, MemoryItem, MemoryScope, ReplayEntry, RetentionConfig, SleepCheckResult } from './types.js'
import { scopeKey } from './types.js'
import { consolidationPrompt } from './prompt.js'
import { parseModelJson } from './json-model.js'
import { z } from 'zod'

const responseSchema = z.object({
  memories: z.array(z.object({
    kind: z.enum(['fact', 'preference', 'constraint', 'procedure']),
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(4000),
    tags: z.array(z.string().min(1)).max(20).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).max(100),
})

export const DEFAULT_RETENTION: RetentionConfig = {
  maxMemories: 200,
  newbornGraceDays: 3,
  consolidateIntervalHours: 24,
  convergedMinIntervalHours: 72,
}

/** Compute a digest of memory titles+contents for convergence detection. */
export function memoryDigest(items: MemoryItem[]): string {
  const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title))
  const content = sorted.map(m => `${m.title}:${m.content}`).join('\n')
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** Check if sleep/auto-consolidate should run. */
export async function shouldConsolidate(
  scope: MemoryScope,
  store: ConsolidationStore & ReplayStore,
  config: RetentionConfig = DEFAULT_RETENTION,
  now = Date.now(),
): Promise<SleepCheckResult> {
  const state = await store.getConsolidationState(scope)
  const replayCount = await store.countUnconsumedReplay(scope)

  const hoursSinceLastConsolidate = state
    ? (now - state.lastConsolidateAt) / (1000 * 60 * 60)
    : Infinity

  const baseInterval = config.consolidateIntervalHours
  const effectiveInterval = state?.converged
    ? Math.max(baseInterval * state.convergenceMultiplier, config.convergedMinIntervalHours)
    : baseInterval

  if (replayCount >= 10) {
    return { shouldConsolidate: true, reason: 'replay', backlogSize: 0, replaySize: replayCount, hoursSinceLastConsolidate }
  }

  if (hoursSinceLastConsolidate >= effectiveInterval) {
    return { shouldConsolidate: true, reason: 'schedule', backlogSize: 0, replaySize: replayCount, hoursSinceLastConsolidate }
  }

  return { shouldConsolidate: false, reason: 'none', backlogSize: 0, replaySize: replayCount, hoursSinceLastConsolidate }
}

/** Enhanced consolidation prompt that includes replay buffer hints. */
export function consolidationPromptWithReplay(items: MemoryItem[], replay: ReplayEntry[]): string {
  let prompt = consolidationPrompt(items)

  if (replay.length) {
    const hints = replay.flatMap(entry =>
      entry.batch.memories.map(m => `- [${m.kind}] ${m.title}: ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`)
    ).slice(0, 20)
    prompt += `\n\nRecent distillations (for context, may overlap with above):\n${hints.join('\n')}`
  }

  return prompt
}

/** Jaccard-like similarity for near-duplicate detection (cheap, no embeddings). */
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  if (!wordsA.size || !wordsB.size) return 0
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return intersection / union
}

/** Find near-duplicate hints for the consolidator. */
export function findNearDuplicates(items: MemoryItem[], threshold = 0.6): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sim = jaccardSimilarity(items[i]!.content, items[j]!.content)
      if (sim >= threshold) {
        pairs.push([items[i]!.title, items[j]!.title])
      }
    }
  }
  return pairs
}

export type SafeConsolidateResult = {
  result: ConsolidationResult | null
  converged: boolean
  restored: boolean
  error?: string
}

/**
 * Safe consolidation with snapshot/restore and convergence detection.
 *
 * - Takes a snapshot before running the model
 * - Restores on empty/broken output
 * - Detects convergence when digest unchanged
 */
export async function safeConsolidate(
  scope: MemoryScope,
  store: MemoryStore & ReplayStore & ConsolidationStore,
  model: ModelRunner,
  config: RetentionConfig = DEFAULT_RETENTION,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<SafeConsolidateResult> {
  const before = await store.list({ scopes: [scope], limit: 1000 })
  if (!before.length) {
    return { result: { before: 0, after: 0, items: [] }, converged: true, restored: false }
  }

  const snapshot = before
  const beforeDigest = memoryDigest(before)
  const state = await store.getConsolidationState(scope)

  const replay = await store.getUnconsumedReplay(scope, 20)
  const nearDupes = findNearDuplicates(before)

  let prompt = consolidationPromptWithReplay(before, replay)
  if (nearDupes.length) {
    prompt += `\n\nPotential duplicates to merge:\n${nearDupes.map(([a, b]) => `- "${a}" and "${b}"`).join('\n')}`
  }

  let parsed
  try {
    const response = await model.complete({ purpose: 'consolidate', prompt, ...(signal ? { signal } : {}) })
    parsed = responseSchema.parse(parseModelJson(response))
  } catch (error) {
    return { result: null, converged: false, restored: false, error: String(error) }
  }

  if (!parsed.memories.length) {
    return { result: null, converged: false, restored: true, error: 'empty consolidation result' }
  }

  const items = parsed.memories.map((candidate, idx): MemoryItem => {
    const existing = before.find(m => m.title.toLowerCase() === candidate.title.toLowerCase())
    return {
      id: existing?.id ?? `consolidated-${idx}-${now}`,
      scope,
      kind: candidate.kind,
      title: candidate.title,
      content: candidate.content,
      tags: candidate.tags ?? [],
      usageCount: existing?.usageCount ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(candidate.confidence !== undefined ? { confidence: candidate.confidence } : {}),
    }
  })

  await store.replace(scope, items)

  if (replay.length) {
    await store.markReplayConsumed(replay.map(r => r.id))
  }

  const afterDigest = memoryDigest(items)
  const converged = afterDigest === beforeDigest || (state?.lastDigest === afterDigest)

  const newMultiplier = converged
    ? Math.min((state?.convergenceMultiplier ?? 1) * 3, 9)
    : 1.0

  await store.setConsolidationState(scope, {
    lastConsolidateAt: now,
    lastDigest: afterDigest,
    converged,
    convergenceMultiplier: newMultiplier,
  })

  return {
    result: { before: before.length, after: items.length, items },
    converged,
    restored: false,
  }
}
