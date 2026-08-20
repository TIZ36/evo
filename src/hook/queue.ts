import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemoryScope, Turn } from '../core/types.js'
import { scopeKey } from '../core/types.js'
import type { HookHost } from './host.js'

/**
 * Turns waiting to be distilled.
 *
 * Reflecting once per turn pays a model call to look at material too thin to
 * generalise from: what makes a memory worth keeping — the pit stepped into
 * three times, the convention confirmed again — is only visible across turns.
 * Batching trades a little latency for a reflector that can see the pattern,
 * and drops the call count by an order of magnitude on the way.
 *
 * The queue lives on disk because a Claude Code hook is a fresh short-lived
 * process every time: there is no resident timer to hold turns in memory, and
 * no process alive between turns to fire one. So "idle for five minutes" is not
 * a timeout that runs — it is a condition every later hook event checks.
 */
export type QueuedTurn = { user: string; assistant: string; tools: string[]; turn: number }
export type QueuedBatch = {
  scope: MemoryScope
  sessionId: string
  /** The host that produced these turns; it decides which CLI distils them later. */
  host: HookHost
  turns: QueuedTurn[]
  chars: number
  updatedAt: number
}
export type QueueLimits = {
  /** Distil once this many turns are waiting. */
  turns: number
  /** …or once they add up to this many characters of conversation. */
  chars: number
  /** …or once the queue has sat untouched this long (checked, never fired). */
  idleMs: number
  userChars: number
  assistantChars: number
  tools: number
}

const FILE = 'hook-queue.json'
type QueueFile = Record<string, QueuedBatch>

function cut(text: string, limit: number): string {
  const value = text.trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function read(dataDir: string): QueueFile {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, FILE), 'utf8')) as QueueFile
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/* Written through a temp file: a hook killed mid-write would otherwise leave
   truncated JSON, and an unreadable queue silently swallows every turn in it. */
function write(dataDir: string, queue: QueueFile): void {
  try {
    mkdirSync(dataDir, { recursive: true })
    const path = join(dataDir, FILE)
    if (!Object.keys(queue).length) { rmSync(path, { force: true }); return }
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(queue))
    renameSync(temporary, path)
  } catch { /* a lost queue must never break a session */ }
}

export function isDue(batch: QueuedBatch, limits: QueueLimits, now: number): boolean {
  return batch.turns.length >= limits.turns || batch.chars >= limits.chars || now - batch.updatedAt >= limits.idleMs
}

/**
 * Add one finished turn. Truncation happens here, on the way in: the reflector
 * is looking for what repeats, and full transcripts bury that under detail —
 * the same reason the batch beats the single turn.
 */
export function enqueue(dataDir: string, turn: Turn, limits: QueueLimits, host: HookHost, now = Date.now()): QueuedBatch {
  const queue = read(dataDir)
  const key = scopeKey(turn.scope)
  const batch: QueuedBatch = queue[key] ?? { scope: turn.scope, sessionId: turn.sessionId, host, turns: [], chars: 0, updatedAt: now }
  batch.sessionId = turn.sessionId
  batch.scope = turn.scope
  batch.host = host
  batch.turns.push({
    user: cut(turn.user, limits.userChars),
    assistant: cut(turn.assistant, limits.assistantChars),
    tools: (turn.tools ?? []).slice(0, limits.tools),
    turn: turn.turn,
  })
  /* Weighed by what was actually said, not by the truncated copy: a long turn
     should push the batch over the line sooner, which is the point of the cap. */
  batch.chars += turn.user.length + turn.assistant.length
  batch.updatedAt = now
  queue[key] = batch
  write(dataDir, queue)
  return batch
}

/**
 * Remove and return the batches ready to distil — all of them, or only the one
 * scope named. Taken before the model runs, so turns arriving during those
 * seconds queue up behind it instead of being distilled twice or dropped.
 */
export function takeDue(dataDir: string, limits: QueueLimits, now = Date.now(), only?: MemoryScope): QueuedBatch[] {
  const queue = read(dataDir)
  const wanted = only ? scopeKey(only) : undefined
  const due: QueuedBatch[] = []
  for (const [key, batch] of Object.entries(queue)) {
    if (wanted && key !== wanted) continue
    if (!batch?.turns?.length || !isDue(batch, limits, now)) continue
    due.push(batch)
    delete queue[key]
  }
  if (due.length) write(dataDir, queue)
  return due
}

/** The queued turns as core `Turn`s, ready for one batched reflection. */
export function batchTurns(batch: QueuedBatch): Turn[] {
  return batch.turns.map(turn => ({
    sessionId: batch.sessionId,
    turn: turn.turn,
    scope: batch.scope,
    user: turn.user,
    assistant: turn.assistant,
    tools: turn.tools,
  }))
}
