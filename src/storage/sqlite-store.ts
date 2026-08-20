import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MemoryEventSink, MemoryStore } from '../core/contracts.js'
import type { MemoryEvent, MemoryEventRecord } from '../core/contracts.js'
import { memoryItemSchema, scopeKey, type MemoryItem, type MemoryQuery, type MemoryScope } from '../core/types.js'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'

type Row = Record<string, unknown>

export class SqliteMemoryStore implements MemoryStore, MemoryEventSink {
  private readonly db: DatabaseSync

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
    this.db.exec(SCHEMA_SQL)
    const version = this.db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as Row | undefined
    if (Number(version?.version) !== SCHEMA_VERSION) throw new Error(`unsupported evo schema version: ${String(version?.version)}`)
  }

  async get(id: string): Promise<MemoryItem | null> {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined
    return row ? decode(row) : null
  }

  async list(query: MemoryQuery = {}): Promise<MemoryItem[]> {
    const where: string[] = []
    const params: (string | number)[] = []
    if (query.scopes?.length) {
      where.push(`scope_key IN (${query.scopes.map(() => '?').join(',')})`)
      params.push(...query.scopes.map(scopeKey))
    }
    if (query.kinds?.length) {
      where.push(`kind IN (${query.kinds.map(() => '?').join(',')})`)
      params.push(...query.kinds)
    }
    if (query.text?.trim()) {
      where.push('(title LIKE ? ESCAPE \'\\\' OR content LIKE ? ESCAPE \'\\\' OR tags_json LIKE ? ESCAPE \'\\\')')
      const pattern = `%${escapeLike(query.text.trim())}%`
      params.push(pattern, pattern, pattern)
    }
    if (query.tags?.length) {
      for (const tag of query.tags) {
        where.push('tags_json LIKE ?')
        params.push(`%${JSON.stringify(tag).slice(1, -1)}%`)
      }
    }
    const limit = Math.max(1, Math.min(query.limit ?? 100, 1000))
    const sql = `SELECT * FROM memories ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY usage_count DESC, updated_at DESC, id ASC LIMIT ?`
    return (this.db.prepare(sql).all(...params, limit) as Row[]).map(decode)
  }

  async put(item: MemoryItem): Promise<void> {
    const value = memoryItemSchema.parse(item)
    this.db.prepare(`INSERT INTO memories
      (id, scope_key, scope_json, kind, title, content, tags_json, confidence, usage_count, created_at, updated_at, source_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET scope_key=excluded.scope_key, scope_json=excluded.scope_json,
      kind=excluded.kind, title=excluded.title, content=excluded.content, tags_json=excluded.tags_json,
      confidence=excluded.confidence, usage_count=excluded.usage_count, updated_at=excluded.updated_at,
      source_json=excluded.source_json`).run(...encode(value))
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  async replace(scope: MemoryScope, items: MemoryItem[]): Promise<void> {
    const key = scopeKey(scope)
    const values = items.map(item => memoryItemSchema.parse(item))
    if (values.some(item => scopeKey(item.scope) !== key)) throw new Error('replacement item scope does not match target scope')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM memories WHERE scope_key = ?').run(key)
      for (const item of values) await this.put(item)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Persist one memory event for the activity log (panel / API consumers). */
  async emit(event: MemoryEvent): Promise<void> {
    const scope = event.type === 'memory.deleted' ? undefined
      : event.type === 'memory.consolidated' ? event.scope
        : event.type === 'memory.reflected' ? event.turn.scope
          : event.item.scope
    this.db.prepare('INSERT INTO memory_events (type, scope_json, payload_json, created_at) VALUES (?, ?, ?, ?)')
      .run(event.type, scope ? JSON.stringify(scope) : null, JSON.stringify(event), Date.now())
  }

  /** Most recent events, newest first. */
  async listEvents(limit = 50): Promise<MemoryEventRecord[]> {
    const rows = this.db.prepare('SELECT type, scope_json, payload_json, created_at FROM memory_events ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 1000))) as Row[]
    return rows.map(row => ({
      type: String(row.type),
      scope: row.scope_json ? JSON.parse(String(row.scope_json)) as MemoryScope : undefined,
      payload: JSON.parse(String(row.payload_json)) as MemoryEvent,
      createdAt: Number(row.created_at),
    }))
  }

  /** Item count per scope key, for the scope-tree view. */
  async countByScopeKey(): Promise<Map<string, number>> {
    const rows = this.db.prepare('SELECT scope_key, COUNT(*) AS count FROM memories GROUP BY scope_key').all() as Row[]
    return new Map(rows.map(row => [String(row.scope_key), Number(row.count)]))
  }

  close(): void { this.db.close() }
}

function encode(item: MemoryItem) {
  return [item.id, scopeKey(item.scope), JSON.stringify(item.scope), item.kind, item.title, item.content,
    JSON.stringify(item.tags), item.confidence ?? null, item.usageCount, item.createdAt, item.updatedAt,
    item.source ? JSON.stringify(item.source) : null] as const
}

function decode(row: Row): MemoryItem {
  return memoryItemSchema.parse({
    id: row.id, scope: JSON.parse(String(row.scope_json)), kind: row.kind, title: row.title,
    content: row.content, tags: JSON.parse(String(row.tags_json)), confidence: row.confidence ?? undefined,
    usageCount: row.usage_count, createdAt: row.created_at, updatedAt: row.updated_at,
    source: row.source_json ? JSON.parse(String(row.source_json)) : undefined,
  })
}

function escapeLike(value: string) { return value.replace(/[\\%_]/g, match => `\\${match}`) }
