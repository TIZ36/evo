/**
 * Claude Code writes one JSON object per line to `transcript_path`. Only some
 * line types carry conversation content; the rest (`attachment`, `last-prompt`,
 * `queue-operation`, …) are bookkeeping. Subagent lines are marked
 * `isSidechain: true` and belong to another agent's turn, not this one.
 */
export type TranscriptLine = {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: { content?: unknown }
}

/** One completed turn, ready to become a core `Turn`. */
export type TurnDraft = { user: string; assistant: string; tools: string[]; turn: number }

export function parseTranscript(text: string): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    // A transcript can be read mid-write; a torn last line is not an error.
    try { lines.push(JSON.parse(trimmed) as TranscriptLine) } catch { continue }
  }
  return lines
}

/**
 * The newest user prompt and everything the assistant did after it.
 * Returns null when the transcript holds no user prompt yet.
 */
export function extractLatestTurn(lines: TranscriptLine[], fallbackAssistant?: string): TurnDraft | null {
  const own = lines.filter(line => line.isSidechain !== true && line.isMeta !== true)
  const promptIndexes = own.map((line, index) => (isUserPrompt(line) ? index : -1)).filter(index => index >= 0)
  const start = promptIndexes.at(-1)
  if (start === undefined) return null

  const user = contentText(own[start]!.message?.content).trim()
  const rest = own.slice(start + 1)
  const assistantText = rest.filter(line => line.type === 'assistant')
    .map(line => contentText(line.message?.content).trim()).filter(Boolean).join('\n\n')
  const tools = [...new Set(rest.flatMap(line => toolNames(line.message?.content)))]

  return { user, assistant: assistantText || (fallbackAssistant ?? '').trim(), tools, turn: promptIndexes.length }
}

/** A real prompt: a user line whose content is not a tool result. */
function isUserPrompt(line: TranscriptLine): boolean {
  if (line.type !== 'user') return false
  const content = line.message?.content
  if (typeof content === 'string') return content.trim().length > 0
  if (!Array.isArray(content)) return false
  return !content.some(block => isRecord(block) && block.type === 'tool_result')
}

/** Visible text only — `thinking` blocks are excluded on purpose. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(block => isRecord(block) && block.type === 'text')
    .map(block => String((block as { text?: unknown }).text ?? '')).join('\n')
}

function toolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content.filter(block => isRecord(block) && block.type === 'tool_use')
    .map(block => String((block as { name?: unknown }).name ?? '')).filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
