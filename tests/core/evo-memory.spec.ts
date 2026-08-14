import { describe, expect, it } from 'vitest'
import { EvoMemoryService } from '../../src/core/evo-memory.js'
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
}

const scope: MemoryScope = { type: 'project', id: '/repo' }
const runner = (response: unknown): ModelRunner => ({ complete: async () => JSON.stringify(response) })

describe('EvoMemoryService', () => {
  it('remembers and renders bounded recall context', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoMemoryService({ store, now: () => 10, id: () => 'm1' })
    await service.remember({ scope, kind: 'constraint', title: 'Tests', content: 'Always run tests', tags: [] })
    expect(await service.context({ scopes: [scope], maxChars: 200 })).toContain('**Tests**: Always run tests')
  })

  it('reflects model candidates and updates a same-title memory', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoMemoryService({ store, model: runner({ memories: [
      { kind: 'preference', title: 'Language', content: 'Use Chinese', tags: ['user'] },
    ] }), now: () => 20, id: () => 'm1' })
    await service.remember({ scope, kind: 'preference', title: 'Language', content: 'Use English', tags: [] })
    const delta = await service.reflect({ sessionId: 's', turn: 1, scope, user: '中文回答', assistant: '好的' })
    expect(delta.updated).toHaveLength(1)
    expect((await store.list())[0]?.content).toBe('Use Chinese')
  })

  it('refuses an empty consolidation result and preserves stored memories', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoMemoryService({ store, model: runner({ memories: [] }), now: () => 20, id: () => 'm1' })
    await service.remember({ scope, kind: 'fact', title: 'One', content: 'value', tags: [] })
    await expect(service.consolidate(scope)).rejects.toThrow('empty')
    expect(await store.list()).toHaveLength(1)
  })
})
