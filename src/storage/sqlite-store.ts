import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ConsolidationStore, MemoryEventSink, MemoryStore, ReplayStore, SkillStore } from '../core/contracts.js'
import type { MemoryEvent, MemoryEventRecord } from '../core/contracts.js'
import { memoryItemSchema, scopeKey, skillBodySchema, skillItemSchema, type ConsolidationState, type MemoryItem, type MemoryKind, type MemoryQuery, type MemoryScope, type ReplayEntry, type SkillItem, type SkillLesson, type SkillQuery } from '../core/types.js'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'

type Row = Record<string, unknown>

export class SqliteMemoryStore implements MemoryStore, SkillStore, ReplayStore, ConsolidationStore, MemoryEventSink {
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
    let scope: MemoryScope | undefined
    switch (event.type) {
      case 'memory.deleted':
        scope = undefined
        break
      case 'memory.consolidated':
        scope = event.scope
        break
      case 'memory.reflected':
        scope = event.turn.scope
        break
      case 'skill.created':
      case 'skill.updated':
        scope = event.skill.scope
        break
      case 'skill.deleted':
      case 'skill.used':
        scope = event.scope
        break
      default:
        scope = event.item.scope
    }
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

  /** Count memories in a scope. */
  async count(scope: MemoryScope): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM memories WHERE scope_key = ?').get(scopeKey(scope)) as Row
    return Number(row.count)
  }

  /** Increment usage count for a memory. */
  async incrementMemoryUsage(id: string): Promise<void> {
    this.db.prepare('UPDATE memories SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), id)
  }

  // ── Skill store ─────────────────────────────────────────────────────────────

  async getSkill(scope: MemoryScope, name: string): Promise<SkillItem | null> {
    const row = this.db.prepare('SELECT * FROM skills WHERE scope_key = ? AND name = ?').get(scopeKey(scope), name) as Row | undefined
    return row ? decodeSkill(row) : null
  }

  async listSkills(query: SkillQuery = {}): Promise<SkillItem[]> {
    const where: string[] = []
    const params: (string | number)[] = []
    if (query.scopes?.length) {
      where.push(`scope_key IN (${query.scopes.map(() => '?').join(',')})`)
      params.push(...query.scopes.map(scopeKey))
    }
    if (query.text?.trim()) {
      where.push('(name LIKE ? ESCAPE \'\\\' OR body_json LIKE ? ESCAPE \'\\\')')
      const pattern = `%${escapeLike(query.text.trim())}%`
      params.push(pattern, pattern)
    }
    if (!query.includeDormant) {
      where.push('dormant = 0')
    }
    const limit = Math.max(1, Math.min(query.limit ?? 100, 1000))
    const sql = `SELECT * FROM skills ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY usage_count DESC, updated_at DESC, name ASC LIMIT ?`
    return (this.db.prepare(sql).all(...params, limit) as Row[]).map(decodeSkill)
  }

  async putSkill(item: SkillItem): Promise<void> {
    const value = skillItemSchema.parse(item)
    this.db.prepare(`INSERT INTO skills
      (scope_key, scope_json, name, body_json, usage_count, created_at, updated_at, source_json, dormant)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key, name) DO UPDATE SET scope_json=excluded.scope_json,
      body_json=excluded.body_json, usage_count=excluded.usage_count, updated_at=excluded.updated_at,
      source_json=excluded.source_json, dormant=excluded.dormant`).run(...encodeSkill(value))
  }

  async deleteSkill(scope: MemoryScope, name: string): Promise<void> {
    this.db.prepare('DELETE FROM skills WHERE scope_key = ? AND name = ?').run(scopeKey(scope), name)
  }

  async getLessons(scope: MemoryScope, name: string): Promise<SkillLesson[]> {
    const rows = this.db.prepare('SELECT text, session_id, turn, created_at FROM skill_lessons WHERE scope_key = ? AND skill_name = ? ORDER BY created_at ASC')
      .all(scopeKey(scope), name) as Row[]
    return rows.map(row => ({
      text: String(row.text),
      sessionId: row.session_id ? String(row.session_id) : undefined,
      turn: row.turn != null ? Number(row.turn) : undefined,
      createdAt: Number(row.created_at),
    }))
  }

  async addLesson(scope: MemoryScope, name: string, lesson: SkillLesson): Promise<void> {
    this.db.prepare('INSERT INTO skill_lessons (scope_key, skill_name, text, session_id, turn, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(scopeKey(scope), name, lesson.text, lesson.sessionId ?? null, lesson.turn ?? null, lesson.createdAt)
  }

  async incrementUsage(scope: MemoryScope, name: string): Promise<void> {
    this.db.prepare('UPDATE skills SET usage_count = usage_count + 1, updated_at = ?, dormant = 0 WHERE scope_key = ? AND name = ?')
      .run(Date.now(), scopeKey(scope), name)
  }

  async getUnfoldedLessons(scope: MemoryScope, name: string): Promise<SkillLesson[]> {
    const rows = this.db.prepare('SELECT text, session_id, turn, created_at FROM skill_lessons WHERE scope_key = ? AND skill_name = ? AND folded = 0 ORDER BY created_at ASC')
      .all(scopeKey(scope), name) as Row[]
    return rows.map(row => ({
      text: String(row.text),
      sessionId: row.session_id ? String(row.session_id) : undefined,
      turn: row.turn != null ? Number(row.turn) : undefined,
      createdAt: Number(row.created_at),
    }))
  }

  async markLessonsFolded(scope: MemoryScope, name: string): Promise<void> {
    this.db.prepare('UPDATE skill_lessons SET folded = 1 WHERE scope_key = ? AND skill_name = ?')
      .run(scopeKey(scope), name)
  }

  async setDormant(scope: MemoryScope, name: string, dormant: boolean): Promise<void> {
    this.db.prepare('UPDATE skills SET dormant = ?, updated_at = ? WHERE scope_key = ? AND name = ?')
      .run(dormant ? 1 : 0, Date.now(), scopeKey(scope), name)
  }

  // ── Replay store ────────────────────────────────────────────────────────────

  async appendReplay(scope: MemoryScope, batch: { memories: Array<{ title: string; content: string; kind: MemoryKind }> }): Promise<void> {
    this.db.prepare('INSERT INTO replay_buffer (scope_key, scope_json, batch_json, created_at) VALUES (?, ?, ?, ?)')
      .run(scopeKey(scope), JSON.stringify(scope), JSON.stringify(batch), Date.now())
  }

  async getUnconsumedReplay(scope: MemoryScope, limit = 50): Promise<ReplayEntry[]> {
    const rows = this.db.prepare('SELECT id, scope_json, batch_json, created_at FROM replay_buffer WHERE scope_key = ? AND consumed = 0 ORDER BY created_at ASC LIMIT ?')
      .all(scopeKey(scope), limit) as Row[]
    return rows.map(row => ({
      id: Number(row.id),
      scope: JSON.parse(String(row.scope_json)) as MemoryScope,
      batch: JSON.parse(String(row.batch_json)) as { memories: Array<{ title: string; content: string; kind: MemoryKind }> },
      createdAt: Number(row.created_at),
      consumed: false,
    }))
  }

  async markReplayConsumed(ids: number[]): Promise<void> {
    if (!ids.length) return
    this.db.prepare(`UPDATE replay_buffer SET consumed = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
  }

  async countUnconsumedReplay(scope: MemoryScope): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM replay_buffer WHERE scope_key = ? AND consumed = 0').get(scopeKey(scope)) as Row
    return Number(row.count)
  }

  // ── Consolidation store ─────────────────────────────────────────────────────

  async getConsolidationState(scope: MemoryScope): Promise<ConsolidationState | null> {
    const key = scopeKey(scope)
    const row = this.db.prepare('SELECT * FROM consolidation_state WHERE scope_key = ?').get(key) as Row | undefined
    if (!row) return null
    return {
      scopeKey: key,
      lastConsolidateAt: Number(row.last_consolidate_at),
      lastDigest: row.last_digest ? String(row.last_digest) : null,
      converged: Boolean(row.converged),
      convergenceMultiplier: Number(row.convergence_multiplier),
    }
  }

  async setConsolidationState(scope: MemoryScope, state: Partial<ConsolidationState>): Promise<void> {
    const key = scopeKey(scope)
    const existing = await this.getConsolidationState(scope)
    if (existing) {
      const updates: string[] = []
      const params: (string | number)[] = []
      if (state.lastConsolidateAt !== undefined) { updates.push('last_consolidate_at = ?'); params.push(state.lastConsolidateAt) }
      if (state.lastDigest !== undefined) { updates.push('last_digest = ?'); params.push(state.lastDigest ?? '') }
      if (state.converged !== undefined) { updates.push('converged = ?'); params.push(state.converged ? 1 : 0) }
      if (state.convergenceMultiplier !== undefined) { updates.push('convergence_multiplier = ?'); params.push(state.convergenceMultiplier) }
      if (updates.length) {
        params.push(key)
        this.db.prepare(`UPDATE consolidation_state SET ${updates.join(', ')} WHERE scope_key = ?`).run(...params)
      }
    } else {
      this.db.prepare('INSERT INTO consolidation_state (scope_key, last_consolidate_at, last_digest, converged, convergence_multiplier) VALUES (?, ?, ?, ?, ?)')
        .run(key, state.lastConsolidateAt ?? 0, state.lastDigest ?? null, state.converged ? 1 : 0, state.convergenceMultiplier ?? 1.0)
    }
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

function encodeSkill(item: SkillItem) {
  return [scopeKey(item.scope), JSON.stringify(item.scope), item.name, JSON.stringify(item.body),
    item.usageCount, item.createdAt, item.updatedAt, item.source ? JSON.stringify(item.source) : null,
    item.dormant ? 1 : 0] as const
}

function decodeSkill(row: Row): SkillItem {
  return skillItemSchema.parse({
    name: row.name,
    scope: JSON.parse(String(row.scope_json)),
    body: skillBodySchema.parse(JSON.parse(String(row.body_json))),
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source_json ? JSON.parse(String(row.source_json)) : undefined,
    dormant: Boolean(row.dormant),
  })
}
