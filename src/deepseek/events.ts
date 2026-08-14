import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { MemoryScope, Turn } from '../core/types.js'

export function scopesForSession(session: Session): MemoryScope[] {
  return [
    { type: 'global' },
    ...(session.header.cwd ? [{ type: 'project' as const, id: session.header.cwd }] : []),
    { type: 'session', id: session.id },
  ]
}

export function primaryScopeForSession(session: Session): MemoryScope {
  return session.header.cwd ? { type: 'project', id: session.header.cwd } : { type: 'global' }
}

export function extractCompletedTurn(session: Session, turn: number): Turn | null {
  const endIndex = findLastIndex(session.events, event => event.type === 'turn/end' && event.data.turn === turn)
  if (endIndex < 0) return null
  const end = session.events[endIndex]
  if (end?.type !== 'turn/end' || end.data.reason.kind !== 'completed') return null
  const startIndex = findLastIndex(session.events.slice(0, endIndex), event => event.type === 'turn/start' && event.data.turn === turn)
  if (startIndex < 0) return null
  const events = session.events.slice(startIndex + 1, endIndex)
  const user = events.filter((event): event is Extract<SessionEvent, { type: 'user/message' }> =>
    event.type === 'user/message' && event.data.source.kind === 'user').flatMap(event => text(event.data.content)).join('\n')
  const assistant = events.filter((event): event is Extract<SessionEvent, { type: 'assistant/message' }> =>
    event.type === 'assistant/message' && event.data.turn === turn).flatMap(event => text(event.data.message.content)).join('\n')
  const tools = events.filter((event): event is Extract<SessionEvent, { type: 'tool/call' }> =>
    event.type === 'tool/call' && event.data.turn === turn).map(event => event.data.name)
  if (!user.trim() && !assistant.trim()) return null
  return { sessionId: session.id, turn, scope: primaryScopeForSession(session), user: user.trim(), assistant: assistant.trim(), tools }
}

function text(blocks: readonly ContentBlock[]): string[] {
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map(block => block.text)
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index--) if (predicate(values[index]!)) return index
  return -1
}
