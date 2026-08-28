import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { evictionScore, findEvictionCandidates, enforceCapacity, trackRecall } from '../../src/core/retention.js'
import { DEFAULT_RETENTION } from '../../src/core/consolidate.js'
import type { MemoryItem, MemoryScope, RetentionConfig } from '../../src/core/types.js'

const scope: MemoryScope = { type: 'project', id: '/repo' }

function makeStore(): { store: SqliteMemoryStore; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'evo-retention-'))
  const path = join(dir, 'evo.db')
  const s = new SqliteMemoryStore(path)
  return { store: s, close: () => { s.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function makeMemory(id: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id, scope, kind: 'fact', title: `Title ${id}`, content: `Content ${id}`,
    tags: [], usageCount: 0, createdAt: 1000, updatedAt: 1000,
    source: { runtime: 'evo' },
    ...overrides,
  }
}

const config: RetentionConfig = {
  maxMemories: 5,
  newbornGraceDays: 3,
  consolidateIntervalHours: 24,
  convergedMinIntervalHours: 72,
}

describe('evictionScore', () => {
  it('gives higher score to frequently used memories', () => {
    const now = Date.now()
    const lowUse = makeMemory('1', { usageCount: 1, createdAt: now - 10 * 24 * 60 * 60 * 1000 })
    const highUse = makeMemory('2', { usageCount: 10, createdAt: now - 10 * 24 * 60 * 60 * 1000 })

    expect(evictionScore(highUse, config, now)).toBeGreaterThan(evictionScore(lowUse, config, now))
  })

  it('protects newborn memories with grace period', () => {
    const now = Date.now()
    const newborn = makeMemory('1', { createdAt: now - 1 * 24 * 60 * 60 * 1000 })
    const old = makeMemory('2', { createdAt: now - 10 * 24 * 60 * 60 * 1000 })

    expect(evictionScore(newborn, config, now)).toBe(Infinity)
    expect(evictionScore(old, config, now)).not.toBe(Infinity)
  })

  it('gives higher score to recently updated memories', () => {
    const now = Date.now()
    const recent = makeMemory('1', { createdAt: now - 10 * 24 * 60 * 60 * 1000, updatedAt: now - 1 * 24 * 60 * 60 * 1000 })
    const stale = makeMemory('2', { createdAt: now - 10 * 24 * 60 * 60 * 1000, updatedAt: now - 20 * 24 * 60 * 60 * 1000 })

    expect(evictionScore(recent, config, now)).toBeGreaterThan(evictionScore(stale, config, now))
  })

  it('prioritizes constraints and facts over procedures', () => {
    const now = Date.now()
    const baseCreatedAt = now - 10 * 24 * 60 * 60 * 1000
    const constraint = makeMemory('1', { kind: 'constraint', createdAt: baseCreatedAt })
    const fact = makeMemory('2', { kind: 'fact', createdAt: baseCreatedAt })
    const procedure = makeMemory('3', { kind: 'procedure', createdAt: baseCreatedAt })

    expect(evictionScore(constraint, config, now)).toBeGreaterThan(evictionScore(fact, config, now))
    expect(evictionScore(fact, config, now)).toBeGreaterThan(evictionScore(procedure, config, now))
  })
})

describe('findEvictionCandidates', () => {
  it('returns empty when under capacity', () => {
    const items = [makeMemory('1'), makeMemory('2'), makeMemory('3')]
    const candidates = findEvictionCandidates(items, config)
    expect(candidates).toHaveLength(0)
  })

  it('returns candidates when over capacity', () => {
    const now = Date.now()
    const items = Array.from({ length: 8 }, (_, i) =>
      makeMemory(`${i}`, { createdAt: now - 10 * 24 * 60 * 60 * 1000 })
    )
    const candidates = findEvictionCandidates(items, config, now)
    expect(candidates.length).toBe(3)
  })

  it('excludes imported workspace items', () => {
    const now = Date.now()
    const items = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeMemory(`evo-${i}`, { createdAt: now - 10 * 24 * 60 * 60 * 1000, source: { runtime: 'evo' } })
      ),
      makeMemory('imported', { createdAt: now - 10 * 24 * 60 * 60 * 1000, source: { runtime: 'workspace-import' } }),
    ]
    const candidates = findEvictionCandidates(items, config, now)
    expect(candidates.every(c => c.item.source?.runtime !== 'workspace-import')).toBe(true)
  })

  it('excludes newborn memories', () => {
    const now = Date.now()
    const items = [
      ...Array.from({ length: 4 }, (_, i) =>
        makeMemory(`old-${i}`, { createdAt: now - 10 * 24 * 60 * 60 * 1000 })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeMemory(`new-${i}`, { createdAt: now - 1 * 24 * 60 * 60 * 1000 })
      ),
    ]
    const candidates = findEvictionCandidates(items, config, now)
    expect(candidates.every(c => !c.item.id.startsWith('new-'))).toBe(true)
  })
})

describe('enforceCapacity', () => {
  it('evicts lowest-scored memories when over cap', async () => {
    const { store, close } = makeStore()
    try {
      const now = Date.now()
      for (let i = 0; i < 8; i++) {
        await store.put(makeMemory(`${i}`, {
          createdAt: now - 10 * 24 * 60 * 60 * 1000,
          usageCount: i,
        }))
      }

      const evicted = await enforceCapacity(scope, store, config, now)

      expect(evicted.length).toBe(3)
      expect(evicted.map(e => e.usageCount).every(u => u < 5)).toBe(true)

      const remaining = await store.list({ scopes: [scope] })
      expect(remaining.length).toBe(5)
    } finally {
      close()
    }
  })
})

describe('trackRecall', () => {
  it('increments usage count for recalled memories', async () => {
    const { store, close } = makeStore()
    try {
      const memory = makeMemory('1')
      await store.put(memory)

      await trackRecall(store, [memory])

      const updated = await store.get('1')
      expect(updated?.usageCount).toBe(1)

      await trackRecall(store, [memory])

      const updated2 = await store.get('1')
      expect(updated2?.usageCount).toBe(2)
    } finally {
      close()
    }
  })
})
