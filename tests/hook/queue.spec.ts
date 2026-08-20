import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { batchTurns, enqueue, isDue, takeDue, type QueueLimits } from '../../src/hook/queue.js'
import type { MemoryScope, Turn } from '../../src/core/types.js'

const limits: QueueLimits = { turns: 3, chars: 1000, idleMs: 300_000, userChars: 10, assistantChars: 12, tools: 2 }
const scope: MemoryScope = { type: 'project', id: '/repo' }
const other: MemoryScope = { type: 'project', id: '/elsewhere' }
const dir = () => mkdtempSync(join(tmpdir(), 'evo-queue-'))
const turn = (overrides: Partial<Turn> = {}): Turn => ({
  sessionId: 's1', turn: 1, scope, user: 'user text', assistant: 'assistant text', tools: ['Bash'], ...overrides,
})

describe('queue', () => {
  it('accumulates turns for a scope until the turn count is reached', () => {
    const data = dir()
    expect(isDue(enqueue(data, turn(), limits, 'claude'), limits, Date.now())).toBe(false)
    expect(isDue(enqueue(data, turn(), limits, 'claude'), limits, Date.now())).toBe(false)
    const third = enqueue(data, turn(), limits, 'claude')
    expect(third.turns).toHaveLength(3)
    expect(isDue(third, limits, Date.now())).toBe(true)
  })

  it('truncates each turn on the way in but weighs the batch by what was said', () => {
    const data = dir()
    const batch = enqueue(data, turn({ user: 'u'.repeat(50), assistant: 'a'.repeat(50), tools: ['A', 'B', 'C', 'D'] }), limits, 'claude')
    expect(batch.turns[0]!.user).toBe(`${'u'.repeat(10)}…`)
    expect(batch.turns[0]!.assistant).toBe(`${'a'.repeat(12)}…`)
    expect(batch.turns[0]!.tools).toEqual(['A', 'B'])
    expect(batch.chars).toBe(100)
  })

  it('comes due on accumulated characters alone', () => {
    const data = dir()
    const batch = enqueue(data, turn({ user: 'u'.repeat(600), assistant: 'a'.repeat(600) }), limits, 'claude')
    expect(batch.turns).toHaveLength(1)
    expect(isDue(batch, limits, Date.now())).toBe(true)
  })

  it('comes due once it has sat idle, which is checked and never fired', () => {
    const data = dir()
    const then = Date.now() - 400_000
    enqueue(data, turn(), limits, 'claude', then)
    expect(takeDue(data, limits, then + 1)).toEqual([])
    expect(takeDue(data, limits, Date.now())).toHaveLength(1)
  })

  it('takes only the scope asked for and leaves the others queued', () => {
    const data = dir()
    for (let index = 0; index < 3; index++) enqueue(data, turn(), limits, 'claude')
    enqueue(data, turn({ scope: other }), limits, 'claude')
    const taken = takeDue(data, limits, Date.now(), scope)
    expect(taken).toHaveLength(1)
    expect(taken[0]!.scope).toEqual(scope)
    /* The other project is untouched — not yet due, and not this scope's business. */
    expect(takeDue(data, limits, Date.now(), other)).toEqual([])
    expect(JSON.parse(readFileSync(join(data, 'hook-queue.json'), 'utf8'))).toHaveProperty('project:%2Felsewhere')
  })

  it('removes what it takes, so a batch is never distilled twice', () => {
    const data = dir()
    for (let index = 0; index < 3; index++) enqueue(data, turn(), limits, 'claude')
    expect(takeDue(data, limits, Date.now())).toHaveLength(1)
    expect(takeDue(data, limits, Date.now())).toEqual([])
  })

  it('restores queued turns as core turns for one batched reflection', () => {
    const data = dir()
    enqueue(data, turn({ turn: 7 }), limits, 'claude')
    const [batch] = takeDue(data, limits, Date.now() + limits.idleMs)
    expect(batchTurns(batch!)).toEqual([
      { sessionId: 's1', turn: 7, scope, user: 'user text', assistant: 'assistant te…', tools: ['Bash'] },
    ])
  })

  it('remembers the host that produced the turns, so a later session distils them through it', () => {
    const data = dir()
    enqueue(data, turn(), limits, 'codex')
    const [batch] = takeDue(data, limits, Date.now() + limits.idleMs)
    expect(batch!.host).toBe('codex')
  })

  it('survives a corrupt queue file instead of swallowing every later turn', () => {
    const data = dir()
    require('node:fs').writeFileSync(join(data, 'hook-queue.json'), '{ truncated')
    expect(enqueue(data, turn(), limits, 'claude').turns).toHaveLength(1)
  })
})
