import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
  const value = new SqliteMemoryStore(join(mkdtempSync(join(tmpdir(), 'evo-')), 'memory.db'))
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

describe('v6 migration: imported non-memories', () => {
  /** Open a store, downgrade its stamp to v5, and hand back the path to reopen. */
  const legacyStore = async (rows: MemoryItem[]): Promise<string> => {
    const path = join(mkdtempSync(join(tmpdir(), 'evo-')), 'memory.db')
    const first = new SqliteMemoryStore(path)
    for (const row of rows) await first.put(row)
    // The rows above predate v6; stamp the file as the version that wrote them.
    const db = new DatabaseSync(path)
    db.exec('UPDATE schema_meta SET version = 5')
    db.close()
    first.close()
    return path
  }
  const imported = (id: string, title: string, path: string, overrides: Partial<MemoryItem> = {}): MemoryItem =>
    item(id, project, { title, source: { runtime: 'workspace-import', path }, ...overrides })

  it('evicts skill bodies, cache documents, and rows whose file is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evo-ws-'))
    const live = join(dir, 'CLAUDE.md')
    const skill = join(dir, '.claude/skills/build/SKILL.md')
    const cached = join(dir, '.codex/.tmp/bundled/guide.md')
    const gone = join(dir, 'AGENTS.md')
    // Every file but `gone` exists, so the skill and cache rows are evicted for
    // what they are, not because their file vanished.
    mkdirSync(join(dir, '.claude/skills/build'), { recursive: true })
    mkdirSync(join(dir, '.codex/.tmp/bundled'), { recursive: true })
    writeFileSync(live, 'rules')
    writeFileSync(skill, '# Build')
    writeFileSync(cached, 'vendored')
    const path = await legacyStore([
      imported('live', 'CLAUDE.md', live),
      imported('skill', '.claude/skills/build/SKILL.md', skill),
      imported('cache', '.codex/.tmp/bundled/guide.md', cached),
      imported('gone', 'AGENTS.md', gone),
    ])

    const migrated = new SqliteMemoryStore(path)
    stores.push(migrated)
    expect((await migrated.list({ scopes: [project] })).map(row => row.id)).toEqual(['live'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps evo memories that merely carry the import tag', async () => {
    const path = await legacyStore([
      item('own', project, { tags: ['workspace-import'], source: { runtime: 'evo' } }),
      item('untagged', project),
    ])
    const migrated = new SqliteMemoryStore(path)
    stores.push(migrated)
    expect((await migrated.list({ scopes: [project] })).map(row => row.id).sort()).toEqual(['own', 'untagged'])
  })

  it('does not run again once the store is stamped v6', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evo-ws-'))
    const gone = join(dir, 'AGENTS.md')
    const path = await legacyStore([imported('gone', 'AGENTS.md', gone)])
    new SqliteMemoryStore(path).close()

    // A row re-imported after the migration must survive the next open, even
    // while its file is missing — the eviction is a one-time upgrade, not a
    // startup sweep that races the filesystem.
    const reopened = new SqliteMemoryStore(path)
    await reopened.put(imported('fresh', 'AGENTS.md', gone))
    reopened.close()
    const again = new SqliteMemoryStore(path)
    stores.push(again)
    expect((await again.list({ scopes: [project] })).map(row => row.id)).toEqual(['fresh'])
    rmSync(dir, { recursive: true, force: true })
  })
})
