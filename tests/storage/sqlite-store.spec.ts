import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import type { MemoryItem, MemoryScope } from '../../src/core/types.js'

const stores: SqliteMemoryStore[] = []
const project: MemoryScope = { type: 'project', id: '/repo' }
const other: MemoryScope = { type: 'project', id: '/other' }
const item = (id: string, scope = project, overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id, scope, kind: 'fact', title: `title ${id}`, content: `content ${id}`, tags: ['tag'],
  usageCount: 0, createdAt: 10, updatedAt: 10, ...overrides,
})
const store = () => {
  const value = new SqliteMemoryStore(join(mkdtempSync(join(tmpdir(), 'evo-memory-')), 'memory.db'))
  stores.push(value)
  return value
}
afterEach(() => { for (const value of stores.splice(0)) value.close() })

describe('SqliteMemoryStore', () => {
  it('persists and filters memories by structured scope', async () => {
    const db = store()
    await db.put(item('a'))
    await db.put(item('b', other))
    expect((await db.list({ scopes: [project] })).map(row => row.id)).toEqual(['a'])
    expect((await db.get('a'))?.scope).toEqual(project)
  })

  it('searches text and orders by usage then freshness', async () => {
    const db = store()
    await db.put(item('a', project, { content: 'uses sqlite', usageCount: 1, updatedAt: 20 }))
    await db.put(item('b', project, { content: 'sqlite guide', usageCount: 3, updatedAt: 10 }))
    expect((await db.list({ text: 'sqlite' })).map(row => row.id)).toEqual(['b', 'a'])
  })

  it('atomically replaces one scope without touching another', async () => {
    const db = store()
    await db.put(item('old'))
    await db.put(item('other', other))
    await db.replace(project, [item('new')])
    expect((await db.list()).map(row => row.id).sort()).toEqual(['new', 'other'])
  })

  it('records memory events and lists them newest first', async () => {
    const db = store()
    const created = item('a')
    await db.emit({ type: 'memory.created', item: created })
    await db.emit({ type: 'memory.deleted', id: 'b' })
    await db.emit({ type: 'memory.consolidated', scope: project, result: { before: 2, after: 1, items: [created] } })
    const events = await db.listEvents()
    expect(events).toHaveLength(3)
    expect(events[0]?.type).toBe('memory.consolidated')
    expect(events[0]?.scope).toEqual(project)
    expect(events[2]?.type).toBe('memory.created')
    expect(events[2]?.payload).toMatchObject({ item: { id: 'a' } })
  })
})
