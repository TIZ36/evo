import type { MemoryItem, Turn } from './types.js'

export function renderMemoryContext(items: MemoryItem[], maxChars = 6000): string {
  if (!items.length || maxChars <= 0) return ''
  const head = '# Relevant memory\n'
  let output = head
  for (const item of items) {
    const line = `- [${item.kind}] **${item.title}**: ${item.content}\n`
    if (output.length + line.length > maxChars) break
    output += line
  }
  return output === head ? '' : output.trimEnd()
}

/**
 * What the reflector is allowed to produce, and what it already knows.
 *
 * `cap` exists because an unbounded reflector treats every turn as quotable:
 * one explanatory answer becomes eight "durable" memories and the store grows
 * faster than it is ever read. `existing` exists because a reflector blind to
 * the store cannot tell a new fact from one it wrote yesterday under a slightly
 * different name — deduplication by exact title only catches the wording it
 * happens to repeat.
 */
export type ReflectionContext = {
  /** Upper bound on memories distilled from this batch. */
  cap: number
  /** Titles already stored in this scope, so the model updates instead of duplicating. */
  existing: string[]
}

/** Memories a batch may produce, scaled to its size: one turn rarely earns more than one. */
export function reflectionCap(turns: number, ceiling = 4): number {
  return Math.max(1, Math.min(ceiling, 1 + Math.floor(turns / 3)))
}

/**
 * One prompt for the whole batch. Distilling turn by turn cannot see what a
 * batch makes obvious — the pit stepped into three times, the path that only
 * looks like a procedure once it repeats — and pays a model call per turn to
 * miss it.
 */
export function reflectionPrompt(turns: Turn[], context: ReflectionContext): string {
  const body = turns
    .map((turn, index) => `--- turn ${index + 1} ---\nUser:\n${turn.user}\n\nAssistant:\n${turn.assistant}\n\nTools: ${(turn.tools ?? []).join(', ')}`)
    .join('\n\n')
  const known = context.existing.length
    ? `\n\nMemory titles already stored in this scope. Reuse a title verbatim to correct or extend that memory; list a title under "evict" only when these turns prove it wrong. Never restate one under a new title:\n${context.existing.map(title => `- ${title}`).join('\n')}`
    : ''
  return `Extract only durable, reusable memory from these ${turns.length} completed agent turn(s). Do not save transient task state, guesses, secrets, credentials, or raw logs.

Prefer what recurs across turns: a pit stepped into more than once, a convention confirmed again, an operating path that took shape. One-off details of a single task are not durable, however true they are — a topic merely explained at length is not durable either.

Return at most ${context.cap} memories, and prefer fewer. Return an empty memories array when nothing is durable; that is the normal outcome for an ordinary turn.

Return JSON only: {"memories":[{"kind":"fact|preference|constraint|procedure|skill","title":"short stable key","content":"concise durable value","tags":["tag"],"confidence":0.0}],"evict":["title of a stored memory these turns disproved"]}${known}

${body}`
}

export function consolidationPrompt(items: MemoryItem[]): string {
  return `Consolidate these memories. Merge duplicates, resolve contradictions in favor of newer and higher-confidence evidence, and preserve distinct durable facts. Never invent information. Return JSON only with the same {"memories":[...]} shape.\n\n${JSON.stringify(items)}`
}
