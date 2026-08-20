import type { TurnDraft } from './transcript.js'

/**
 * Codex writes its session rollout as one JSON object per line, but with a
 * different envelope from Claude Code: every line is `{ type, payload }`, where
 * `type` separates the model-facing history (`response_item`) from the UI event
 * stream (`event_msg`). The event stream is the better source for a turn — its
 * `user_message` carries the prompt without the `<environment_context>` block
 * Codex prepends to the model-facing copy, and its `agent_message` carries the
 * assistant's visible answer with reasoning already split off.
 */
export type CodexLine = {
  type?: string
  payload?: {
    type?: string
    role?: string
    message?: unknown
    name?: unknown
    content?: unknown
  }
}

export function parseCodexTranscript(text: string): CodexLine[] {
  const lines: CodexLine[] = []
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    // A rollout can be read mid-write; a torn last line is not an error.
    try { lines.push(JSON.parse(trimmed) as CodexLine) } catch { continue }
  }
  return lines
}

/**
 * Both hosts write JSONL, so the transcript itself says which one produced it:
 * only Codex wraps its lines in the `session_meta` / `response_item` /
 * `event_msg` envelope. Sniffing beats guessing from the environment, because
 * the host that spawned the hook is the host whose transcript this is.
 */
export function isCodexTranscript(text: string): boolean {
  for (const line of parseCodexTranscript(text)) {
    if (line.type === 'session_meta' || line.type === 'response_item' || line.type === 'event_msg') return true
    if (line.type === 'user' || line.type === 'assistant') return false
  }
  return false
}

/** The newest user prompt and everything the agent did after it. */
export function extractLatestCodexTurn(lines: CodexLine[], fallbackAssistant?: string): TurnDraft | null {
  const promptIndexes = lines.map((line, index) => (isUserMessage(line) ? index : -1)).filter(index => index >= 0)
  const start = promptIndexes.at(-1)
  if (start === undefined) return null

  const user = messageText(lines[start]!).trim()
  const rest = lines.slice(start + 1)
  const assistant = rest.filter(isAgentMessage).map(line => messageText(line).trim()).filter(Boolean).join('\n\n')
  const tools = [...new Set(rest.map(toolName).filter(Boolean))]

  return { user, assistant: assistant || (fallbackAssistant ?? '').trim(), tools, turn: promptIndexes.length }
}

function isUserMessage(line: CodexLine): boolean {
  return line.type === 'event_msg' && line.payload?.type === 'user_message' && messageText(line).trim().length > 0
}

function isAgentMessage(line: CodexLine): boolean {
  return line.type === 'event_msg' && line.payload?.type === 'agent_message'
}

/**
 * Tool calls arrive as response items. `function_call` and `custom_tool_call`
 * name themselves; `local_shell_call` is the built-in shell and carries no name.
 */
function toolName(line: CodexLine): string {
  if (line.type !== 'response_item') return ''
  const kind = line.payload?.type
  if (kind === 'local_shell_call') return 'shell'
  if (kind !== 'function_call' && kind !== 'custom_tool_call') return ''
  return String(line.payload?.name ?? '')
}

function messageText(line: CodexLine): string {
  const message = line.payload?.message
  if (typeof message === 'string') return message
  return ''
}
