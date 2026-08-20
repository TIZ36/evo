import { describe, expect, it } from 'vitest'
import { extractLatestTurn, parseTranscript } from '../../src/hook/transcript.js'

const line = (value: unknown) => JSON.stringify(value)
const userPrompt = (text: string) => line({ type: 'user', isSidechain: false, message: { content: text } })
const assistantText = (text: string) => line({ type: 'assistant', isSidechain: false, message: { content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text }] } })
const assistantTool = (name: string) => line({ type: 'assistant', isSidechain: false, message: { content: [{ type: 'tool_use', id: 't1', name, input: {} }] } })
const toolResult = () => line({ type: 'user', isSidechain: false, message: { content: [{ type: 'tool_result', content: 'ok' }] } })

describe('transcript', () => {
  it('skips bookkeeping lines and a torn final line', () => {
    const lines = parseTranscript([line({ type: 'queue-operation' }), userPrompt('hi'), '{"type":"attach'].join('\n'))
    expect(lines).toHaveLength(2)
  })

  it('extracts the newest turn with its tools', () => {
    const text = [
      userPrompt('first question'), assistantText('first answer'),
      userPrompt('second question'), assistantTool('Write'), toolResult(), assistantText('done'),
    ].join('\n')
    const turn = extractLatestTurn(parseTranscript(text))
    expect(turn).toEqual({ user: 'second question', assistant: 'done', tools: ['Write'], turn: 2 })
  })

  it('ignores subagent lines and thinking blocks', () => {
    const text = [
      userPrompt('main question'),
      line({ type: 'user', isSidechain: true, message: { content: 'subagent question' } }),
      line({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent answer' }] } }),
      assistantText('main answer'),
    ].join('\n')
    expect(extractLatestTurn(parseTranscript(text))).toMatchObject({ user: 'main question', assistant: 'main answer' })
  })

  it('falls back to last_assistant_message when the transcript has no text block yet', () => {
    const turn = extractLatestTurn(parseTranscript(userPrompt('question')), 'streamed answer')
    expect(turn).toMatchObject({ assistant: 'streamed answer', turn: 1 })
  })

  it('returns null without a user prompt', () => {
    expect(extractLatestTurn(parseTranscript(line({ type: 'assistant', message: { content: [] } })))).toBeNull()
  })
})
