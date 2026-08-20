import { describe, expect, it } from 'vitest'
import { extractLatestCodexTurn, isCodexTranscript, parseCodexTranscript } from '../../src/hook/codex-transcript.js'
import { hookHost } from '../../src/hook/host.js'

const line = (value: unknown) => JSON.stringify(value)

const rollout = [
  line({ type: 'session_meta', payload: { id: 's1', cwd: '/repo' } }),
  line({ type: 'event_msg', payload: { type: 'user_message', message: 'first question' } }),
  line({ type: 'event_msg', payload: { type: 'agent_message', message: 'first answer' } }),
  line({ type: 'event_msg', payload: { type: 'user_message', message: 'always run pnpm check before pushing' } }),
  line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…</environment_context>' }] } }),
  line({ type: 'event_msg', payload: { type: 'agent_reasoning', message: 'thinking out loud' } }),
  line({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch' } }),
  line({ type: 'response_item', payload: { type: 'function_call', name: 'update_plan' } }),
  line({ type: 'response_item', payload: { type: 'local_shell_call' } }),
  line({ type: 'event_msg', payload: { type: 'agent_message', message: 'added the gate' } }),
  '{"type":"event_msg","payload":{"type":"token_c',
].join('\n')

describe('codex transcript', () => {
  it('survives a rollout that is still being written', () => {
    expect(parseCodexTranscript(rollout)).toHaveLength(10)
  })

  it('reads the newest turn from the event stream, not the model-facing copy', () => {
    const draft = extractLatestCodexTurn(parseCodexTranscript(rollout))
    expect(draft).toMatchObject({ user: 'always run pnpm check before pushing', assistant: 'added the gate', turn: 2 })
    expect(draft?.user).not.toContain('environment_context')
  })

  it('names the tools the turn used, shell included', () => {
    expect(extractLatestCodexTurn(parseCodexTranscript(rollout))?.tools).toEqual(['apply_patch', 'update_plan', 'shell'])
  })

  it('falls back to the reported last message when the stream has no answer yet', () => {
    const partial = [line({ type: 'event_msg', payload: { type: 'user_message', message: 'ask' } })].join('\n')
    expect(extractLatestCodexTurn(parseCodexTranscript(partial), 'reported answer')?.assistant).toBe('reported answer')
  })

  it('has no turn before the first prompt', () => {
    expect(extractLatestCodexTurn(parseCodexTranscript(line({ type: 'session_meta', payload: {} })))).toBeNull()
  })
})

describe('host detection', () => {
  const claudeTranscript = [
    line({ type: 'user', message: { content: 'hello' } }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
  ].join('\n')

  it('believes the transcript over the environment', () => {
    expect(hookHost({ CODEX_HOME: '/somewhere' }, claudeTranscript)).toBe('claude')
    expect(hookHost({ CLAUDE_PLUGIN_ROOT: '/somewhere' }, rollout)).toBe('codex')
    expect(isCodexTranscript(claudeTranscript)).toBe(false)
    expect(isCodexTranscript(rollout)).toBe(true)
  })

  it('falls back to the variables Codex exports and Claude Code does not', () => {
    expect(hookHost({ PLUGIN_ROOT: '/plugins/evo', CLAUDE_PLUGIN_ROOT: '/plugins/evo' })).toBe('codex')
    expect(hookHost({ CLAUDE_PLUGIN_ROOT: '/plugins/evo' })).toBe('claude')
    expect(hookHost({})).toBe('claude')
  })

  it('is overridable when a host blurs both signals', () => {
    expect(hookHost({ EVO_HOOK_HOST: 'codex' }, claudeTranscript)).toBe('codex')
    expect(hookHost({ EVO_HOOK_HOST: 'Claude' }, rollout)).toBe('claude')
  })
})
