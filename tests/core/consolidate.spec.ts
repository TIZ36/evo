import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { memoryDigest, jaccardSimilarity, findNearDuplicates, shouldConsolidate, safeConsolidate, DEFAULT_RETENTION } from '../../src/core/consolidate.js'
import type { MemoryItem, MemoryScope } from '../../src/core/types.js'
import type { ModelRunner } from '../../src/core/contracts.js'

const scope: MemoryScope = { type: 'project', id: '/repo' }

function makeStore(): { store: SqliteMemoryStore; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'evo-consolidate-'))
  const path = join(dir, 'evo.db')
  const s = new SqliteMemoryStore(path)
  return { store: s, close: () => { s.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function makeMemory(id: string, title: string, content: string): MemoryItem {
  return {
    id, scope, kind: 'fact', title, content,
    tags: [], usageCount: 0, createdAt: 1000, updatedAt: 1000,
    source: { runtime: 'evo' },
  }
}

const mockRunner = (response: unknown): ModelRunner => ({
  complete: async () => JSON.stringify(response),
})

describe('memoryDigest', () => {
  it('produces consistent digest for same content', () => {
    const items = [makeMemory('1', 'Title A', 'Content A'), makeMemory('2', 'Title B', 'Content B')]
    const d1 = memoryDigest(items)
    const d2 = memoryDigest(items)
    expect(d1).toBe(d2)
  })

  it('produces different digest for different content', () => {
    const items1 = [makeMemory('1', 'Title A', 'Content A')]
    const items2 = [makeMemory('1', 'Title A', 'Content B')]
    expect(memoryDigest(items1)).not.toBe(memoryDigest(items2))
  })

  it('is order-independent (sorted by title)', () => {
    const items1 = [makeMemory('1', 'A', 'X'), makeMemory('2', 'B', 'Y')]
    const items2 = [makeMemory('2', 'B', 'Y'), makeMemory('1', 'A', 'X')]
    expect(memoryDigest(items1)).toBe(memoryDigest(items2))
  })
})

describe('jaccardSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(jaccardSimilarity('hello world', 'hello world')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(jaccardSimilarity('hello world', 'foo bar baz')).toBe(0)
  })

  it('returns partial similarity for overlapping content', () => {
    const sim = jaccardSimilarity('use pnpm for package management', 'prefer pnpm over npm for packages')
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThan(1)
  })
})

describe('findNearDuplicates', () => {
  it('finds similar memories', () => {
    const items = [
      makeMemory('1', 'Use pnpm', 'Always use pnpm for package management'),
      makeMemory('2', 'Package manager', 'Use pnpm for managing packages'),
      makeMemory('3', 'Testing', 'Always run tests before commit'),
    ]
    const dupes = findNearDuplicates(items, 0.3)
    expect(dupes.length).toBeGreaterThan(0)
    expect(dupes.some(([a, b]) => (a === 'Use pnpm' && b === 'Package manager') || (a === 'Package manager' && b === 'Use pnpm'))).toBe(true)
  })

  it('returns empty for distinct memories', () => {
    const items = [
      makeMemory('1', 'A', 'The sky is blue'),
      makeMemory('2', 'B', 'Water is wet'),
      makeMemory('3', 'C', 'Fire is hot'),
    ]
    const dupes = findNearDuplicates(items, 0.5)
    expect(dupes).toHaveLength(0)
  })
})

describe('shouldConsolidate', () => {
  it('returns true when replay buffer is large', async () => {
    const { store, close } = makeStore()
    try {
      for (let i = 0; i < 12; i++) {
        await store.appendReplay(scope, { memories: [{ title: `T${i}`, content: `C${i}`, kind: 'fact' }] })
      }
      const result = await shouldConsolidate(scope, store, DEFAULT_RETENTION)
      expect(result.shouldConsolidate).toBe(true)
      expect(result.reason).toBe('replay')
    } finally {
      close()
    }
  })

  it('returns true when enough time has passed', async () => {
    const { store, close } = makeStore()
    try {
      await store.setConsolidationState(scope, {
        lastConsolidateAt: Date.now() - 25 * 60 * 60 * 1000,
        converged: false,
      })
      const result = await shouldConsolidate(scope, store, DEFAULT_RETENTION)
      expect(result.shouldConsolidate).toBe(true)
      expect(result.reason).toBe('schedule')
    } finally {
      close()
    }
  })

  it('waits longer when converged', async () => {
    const { store, close } = makeStore()
    try {
      await store.setConsolidationState(scope, {
        lastConsolidateAt: Date.now() - 50 * 60 * 60 * 1000,
        converged: true,
        convergenceMultiplier: 3,
      })
      const result = await shouldConsolidate(scope, store, DEFAULT_RETENTION)
      expect(result.shouldConsolidate).toBe(false)
    } finally {
      close()
    }
  })
})

describe('safeConsolidate', () => {
  it('consolidates memories and updates state', async () => {
    const { store, close } = makeStore()
    try {
      await store.put(makeMemory('1', 'Fact A', 'Value A'))
      await store.put(makeMemory('2', 'Fact B', 'Value B'))

      const runner = mockRunner({
        memories: [
          { kind: 'fact', title: 'Merged Fact', content: 'Combined A and B' },
        ],
      })

      const result = await safeConsolidate(scope, store, runner, DEFAULT_RETENTION)

      expect(result.result?.before).toBe(2)
      expect(result.result?.after).toBe(1)
      expect(result.error).toBeUndefined()

      const state = await store.getConsolidationState(scope)
      expect(state?.lastConsolidateAt).toBeGreaterThan(0)
    } finally {
      close()
    }
  })

  it('detects convergence when digest unchanged', async () => {
    const { store, close } = makeStore()
    try {
      const memory = makeMemory('1', 'Stable Fact', 'Stable Value')
      await store.put(memory)

      const runner = mockRunner({
        memories: [
          { kind: 'fact', title: 'Stable Fact', content: 'Stable Value' },
        ],
      })

      const result = await safeConsolidate(scope, store, runner, DEFAULT_RETENTION)

      expect(result.converged).toBe(true)

      const state = await store.getConsolidationState(scope)
      expect(state?.converged).toBe(true)
      expect(state?.convergenceMultiplier).toBe(3)
    } finally {
      close()
    }
  })

  it('returns error on empty result but does not throw', async () => {
    const { store, close } = makeStore()
    try {
      await store.put(makeMemory('1', 'Keep Me', 'Value'))

      const runner = mockRunner({ memories: [] })

      const result = await safeConsolidate(scope, store, runner, DEFAULT_RETENTION)

      expect(result.result).toBeNull()
      expect(result.error).toContain('empty')

      const remaining = await store.list({ scopes: [scope] })
      expect(remaining).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('consumes replay buffer entries', async () => {
    const { store, close } = makeStore()
    try {
      await store.put(makeMemory('1', 'Base', 'Value'))
      await store.appendReplay(scope, { memories: [{ title: 'Replay', content: 'Data', kind: 'fact' }] })

      const beforeCount = await store.countUnconsumedReplay(scope)
      expect(beforeCount).toBe(1)

      const runner = mockRunner({
        memories: [{ kind: 'fact', title: 'Result', content: 'Combined' }],
      })

      await safeConsolidate(scope, store, runner, DEFAULT_RETENTION)

      const afterCount = await store.countUnconsumedReplay(scope)
      expect(afterCount).toBe(0)
    } finally {
      close()
    }
  })
})
