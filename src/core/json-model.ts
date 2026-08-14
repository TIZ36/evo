export function parseModelJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? balancedJson(text)
  if (!source) throw new Error('model response did not contain valid JSON')
  try { return JSON.parse(source) as T }
  catch { throw new Error('model response did not contain valid JSON') }
}

function balancedJson(text: string): string | undefined {
  for (const open of ['{', '['] as const) {
    const start = text.indexOf(open)
    if (start < 0) continue
    const close = open === '{' ? '}' : ']'
    let depth = 0; let quoted = false; let escaped = false
    for (let index = start; index < text.length; index++) {
      const char = text[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === open) depth++
      else if (char === close && --depth === 0) return text.slice(start, index + 1)
    }
  }
}
