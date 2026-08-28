import type { MemoryStore } from './contracts.js'
import type { MemoryItem, MemoryScope, RetentionConfig } from './types.js'
import { DEFAULT_RETENTION } from './consolidate.js'

/** Memories evo distilled itself — the only ones it may evict. */
const OWN_RUNTIMES = new Set(['evo', 'evo-memory'])
const isOwn = (item: MemoryItem) => OWN_RUNTIMES.has(item.source?.runtime ?? '')

export type EvictionCandidate = {
  item: MemoryItem
  score: number
  reason: 'low_use' | 'stale' | 'over_cap'
}

/**
 * Score a memory for eviction. Lower score = more likely to evict.
 *
 * Factors:
 * - Usage count (higher = keep)
 * - Recency (more recent = keep)
 * - Kind priority (facts/constraints > preferences > procedures)
 * - Newborn grace (recently created = protected)
 */
export function evictionScore(
  item: MemoryItem,
  config: RetentionConfig,
  now = Date.now(),
): number {
  const ageMs = now - item.createdAt
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  const recencyMs = now - item.updatedAt
  const recencyDays = recencyMs / (1000 * 60 * 60 * 24)

  if (ageDays < config.newbornGraceDays) {
    return Infinity
  }

  let score = 0

  score += item.usageCount * 10

  score += Math.max(0, 30 - recencyDays)

  const kindPriority: Record<string, number> = {
    constraint: 20,
    fact: 15,
    preference: 10,
    procedure: 5,
    skill: 5,
  }
  score += kindPriority[item.kind] ?? 0

  if (item.confidence !== undefined) {
    score += item.confidence * 10
  }

  return score
}

/**
 * Find candidates for eviction when over capacity.
 *
 * Only evo-owned memories are candidates. Imported workspace files are never evicted.
 * Returns items sorted by score (lowest first = most evictable).
 */
export function findEvictionCandidates(
  items: MemoryItem[],
  config: RetentionConfig = DEFAULT_RETENTION,
  now = Date.now(),
): EvictionCandidate[] {
  const ownItems = items.filter(isOwn)
  const overBy = items.length - config.maxMemories

  if (overBy <= 0) return []

  const scored = ownItems.map(item => ({
    item,
    score: evictionScore(item, config, now),
    reason: 'over_cap' as const,
  }))

  scored.sort((a, b) => a.score - b.score)

  return scored.filter(c => c.score !== Infinity).slice(0, overBy)
}

/**
 * Enforce store capacity by evicting lowest-scored memories.
 *
 * Evicted items are demoted (deleted) rather than archived.
 * Returns the items that were evicted.
 */
export async function enforceCapacity(
  scope: MemoryScope,
  store: MemoryStore,
  config: RetentionConfig = DEFAULT_RETENTION,
  now = Date.now(),
): Promise<MemoryItem[]> {
  const items = await store.list({ scopes: [scope], limit: 1000 })
  const candidates = findEvictionCandidates(items, config, now)

  const evicted: MemoryItem[] = []
  for (const candidate of candidates) {
    await store.delete(candidate.item.id)
    evicted.push(candidate.item)
  }

  return evicted
}

/**
 * Increment usage count for memories that were recalled.
 *
 * Called when memories are injected into context, tracking which ones are actually used.
 */
export async function trackRecall(
  store: MemoryStore,
  items: MemoryItem[],
): Promise<void> {
  for (const item of items) {
    await store.incrementMemoryUsage(item.id)
  }
}
