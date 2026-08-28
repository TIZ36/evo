import { describe, expect, it } from 'vitest'
import { EvoService } from '../../src/core/evo.js'
import type { MemoryItem, MemoryScope } from '../../src/core/types.js'
import type { MemoryStore, ModelRunner } from '../../src/core/contracts.js'

class MemoryStoreStub implements MemoryStore {
  rows = new Map<string, MemoryItem>()
  async get(id: string) { return this.rows.get(id) ?? null }
  async list() { return [...this.rows.values()] }
  async put(item: MemoryItem) { this.rows.set(item.id, item) }
  async delete(id: string) { this.rows.delete(id) }
  async replace(scope: MemoryScope, items: MemoryItem[]) {
    for (const [id, row] of this.rows) if (JSON.stringify(row.scope) === JSON.stringify(scope)) this.rows.delete(id)
    for (const row of items) this.rows.set(row.id, row)
  }
  async count(scope: MemoryScope) {
    return [...this.rows.values()].filter(r => JSON.stringify(r.scope) === JSON.stringify(scope)).length
  }
  async incrementMemoryUsage(id: string) {
    const item = this.rows.get(id)
    if (item) { item.usageCount += 1; this.rows.set(id, item) }
  }
}

const scope: MemoryScope = { type: 'project', id: '/repo' }
const runner = (response: unknown): ModelRunner => ({ complete: async () => JSON.stringify(response) })

describe('EvoService', () => {
  it('remembers and renders bounded recall context', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoService({ store, now: () => 10, id: () => 'm1' })
    await service.remember({ scope, kind: 'constraint', title: 'Tests', content: 'Always run tests', tags: [] })
    expect(await service.context({ scopes: [scope], maxChars: 200 })).toContain('**Tests**: Always run tests')
  })

  it('reflects model candidates and updates a same-title memory', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoService({ store, model: runner({ memories: [
      { kind: 'preference', title: 'Language', content: 'Use Chinese', tags: ['user'] },
    ] }), now: () => 20, id: () => 'm1' })
    await service.remember({ scope, kind: 'preference', title: 'Language', content: 'Use English', tags: [] })
    const delta = await service.reflect({ sessionId: 's', turn: 1, scope, user: '中文回答', assistant: '好的' })
    expect(delta.updated).toHaveLength(1)
    expect((await store.list())[0]?.content).toBe('Use Chinese')
  })

  it('distils a whole batch in one call, and tells the reflector what it already stores', async () => {
    const store = new MemoryStoreStub()
    let seen = ''
    let calls = 0
    const service = new EvoService({ store, model: { complete: async request => { calls++; seen = request.prompt; return '{"memories":[]}' } }, now: () => 20, id: () => 'm1' })
    store.rows.set('own', { id: 'own', scope, kind: 'fact', title: 'Distilled fact', content: 'v', tags: [], usageCount: 0, createdAt: 1, updatedAt: 1, source: { runtime: 'evo' } })
    store.rows.set('imported', { id: 'imported', scope, kind: 'fact', title: 'CLAUDE.md', content: 'rules', tags: ['workspace-import'], usageCount: 0, createdAt: 1, updatedAt: 1, source: { runtime: 'workspace-import', path: '/repo/CLAUDE.md' } })

    await service.reflectBatch([
      { sessionId: 's', turn: 1, scope, user: 'first', assistant: 'a1' },
      { sessionId: 's', turn: 2, scope, user: 'second', assistant: 'a2' },
      { sessionId: 's', turn: 3, scope, user: 'third', assistant: 'a3' },
    ])

    expect(calls).toBe(1)
    expect(seen).toContain('turn 3')
    expect(seen).toContain('first')
    expect(seen).toContain('third')
    /* Its own memories are offered for reuse; an imported file is not evo's to rewrite. */
    expect(seen).toContain('Distilled fact')
    expect(seen).not.toContain('CLAUDE.md')
  })

  it('caps what one batch may produce, however much the model returns', async () => {
    const store = new MemoryStoreStub()
    let id = 0
    const service = new EvoService({ store, now: () => 20, id: () => `m${++id}`, model: runner({ memories: [1, 2, 3, 4, 5].map(n => ({ kind: 'fact', title: `T${n}`, content: `c${n}` })) }) })
    const turns = [1, 2, 3].map(n => ({ sessionId: 's', turn: n, scope, user: `u${n}`, assistant: `a${n}` }))
    const result = await service.reflectBatch(turns)
    /* cap = 1 + floor(3/3) = 2 */
    expect(result.memories.created).toHaveLength(2)
    expect(await store.list()).toHaveLength(2)
  })

  it('evicts only what it distilled itself, never an imported file', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoService({ store, now: () => 20, id: () => 'm1', model: runner({ memories: [], evict: ['Stale rule', 'CLAUDE.md'] }) })
    store.rows.set('own', { id: 'own', scope, kind: 'fact', title: 'Stale rule', content: 'v', tags: [], usageCount: 0, createdAt: 1, updatedAt: 1, source: { runtime: 'evo' } })
    store.rows.set('imported', { id: 'imported', scope, kind: 'fact', title: 'CLAUDE.md', content: 'rules', tags: [], usageCount: 0, createdAt: 1, updatedAt: 1, source: { runtime: 'workspace-import' } })

    const result = await service.reflectBatch([{ sessionId: 's', turn: 1, scope, user: 'u', assistant: 'a' }])
    expect(result.memories.deleted).toEqual(['own'])
    expect((await store.list()).map(item => item.id)).toEqual(['imported'])
  })

  it('still owns memories written under the pre-rename runtime name', async () => {
    const store = new MemoryStoreStub()
    let seen = ''
    const service = new EvoService({ store, now: () => 20, id: () => 'm1', model: { complete: async request => { seen = request.prompt; return '{"memories":[],"evict":["Legacy rule"]}' } } })
    store.rows.set('legacy', { id: 'legacy', scope, kind: 'fact', title: 'Legacy rule', content: 'v', tags: [], usageCount: 0, createdAt: 1, updatedAt: 1, source: { runtime: 'evo-memory' } })

    const result = await service.reflectBatch([{ sessionId: 's', turn: 1, scope, user: 'u', assistant: 'a' }])
    expect(seen).toContain('Legacy rule')
    expect(result.memories.deleted).toEqual(['legacy'])
  })

  it('keeps a memory the same batch rewrote, treating it as a correction', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoService({ store, now: () => 20, id: () => 'm1', model: runner({ memories: [{ kind: 'fact', title: 'Rule', content: 'new value' }], evict: ['Rule'] }) })
    store.rows.set('own', { id: 'own', scope, kind: 'fact', title: 'Rule', content: 'old value', tags: [], usageCount: 0, createdAt: 1, updatedAt: 1, source: { runtime: 'evo' } })

    const result = await service.reflectBatch([{ sessionId: 's', turn: 1, scope, user: 'u', assistant: 'a' }])
    expect(result.memories.deleted).toEqual([])
    expect((await store.list())[0]?.content).toBe('new value')
  })

  it('refuses an empty consolidation result and preserves stored memories', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoService({ store, model: runner({ memories: [] }), now: () => 20, id: () => 'm1' })
    await service.remember({ scope, kind: 'fact', title: 'One', content: 'value', tags: [] })
    await expect(service.consolidate(scope)).rejects.toThrow('empty')
    expect(await store.list()).toHaveLength(1)
  })
})
