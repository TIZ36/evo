import { describe, expect, it } from 'vitest'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { extractCompletedTurn, scopesForSession } from '../../src/deepseek/events.js'

describe('DeepSeek event adapter', () => {
  it('extracts user, assistant, and tools from a completed Harness turn', () => {
    const session = Session.create('s1' as never, [], { version: SESSION_FORMAT_VERSION, id: 's1', createdAt: 1, cwd: '/repo' } as never)
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 0 })
    session.append('assistant/message', { turn: 1, step: 0, message: createAssistantMessage({ content: [{ type: 'text', text: 'answer' }], source: { provider: 'deepseek', model: 'm' } }) }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 0, callId: 'c1' as never, name: 'read', arguments: '{}' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(extractCompletedTurn(session, 1)).toMatchObject({ user: 'question', assistant: 'answer', tools: ['read'] })
    expect(scopesForSession(session)).toEqual([{ type: 'global' }, { type: 'project', id: '/repo' }, { type: 'session', id: 's1' }])
  })

  it('ignores a non-completed turn', () => {
    const session = Session.create('s2' as never)
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    expect(extractCompletedTurn(session, 1)).toBeNull()
  })
})
