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

export function reflectionPrompt(turn: Turn): string {
  return `Extract only durable, reusable memory from this completed agent turn. Do not save transient task state, guesses, secrets, credentials, or raw logs. Return JSON only: {"memories":[{"kind":"fact|preference|constraint|procedure|skill","title":"short stable key","content":"concise durable value","tags":["tag"],"confidence":0.0}]}. Return an empty memories array when nothing is durable.\n\nUser:\n${turn.user}\n\nAssistant:\n${turn.assistant}\n\nTools:\n${(turn.tools ?? []).join(', ')}`
}

export function consolidationPrompt(items: MemoryItem[]): string {
  return `Consolidate these memories. Merge duplicates, resolve contradictions in favor of newer and higher-confidence evidence, and preserve distinct durable facts. Never invent information. Return JSON only with the same {"memories":[...]} shape.\n\n${JSON.stringify(items)}`
}
