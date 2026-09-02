import type { MemoryItem, MemoryScope, SkillItem, Turn } from './types.js'

/** Catalog entry for a skill: name + trigger + path, not the full body. */
export type SkillCatalogEntry = {
  name: string
  trigger: string
  path: string
  /** Uses >= 3 indicates a mature/established skill. */
  promoted?: boolean
  /** Scope for deduplication: skills are unique by (scope_key, path). */
  scope?: MemoryScope
}

/**
 * Render recalled memories and skill catalog into model context.
 *
 * Memories are rendered inline. Skills are listed as catalog entries only —
 * the model can Read the SKILL.md if needed, keeping context small.
 */
export function renderMemoryContext(items: MemoryItem[], skills: SkillCatalogEntry[] = [], maxChars = 6000): string {
  if ((!items.length && !skills.length) || maxChars <= 0) return ''
  let output = ''

  if (items.length) {
    output = '# Relevant memory\n'
    for (const item of items) {
      const line = `- [${item.kind}] **${item.title}**: ${item.content}\n`
      if (output.length + line.length > maxChars) break
      output += line
    }
  }

  if (skills.length && output.length < maxChars) {
    const skillHead = output ? '\n# Available skills (Read SKILL.md on use)\n' : '# Available skills (Read SKILL.md on use)\n'
    if (output.length + skillHead.length < maxChars) {
      output += skillHead
      for (const skill of skills) {
        const promotedMark = skill.promoted ? ' ★' : ''
        const line = `- **${skill.name}**${promotedMark}: ${skill.trigger} → \`${skill.path}\`\n`
        if (output.length + line.length > maxChars) break
        output += line
      }
    }
  }

  return output.trimEnd()
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
  /** Skills already stored in this scope, so the model updates instead of duplicating. */
  existingSkills: string[]
  /** Titles already stored at global scope (for dedup across scopes). */
  existingGlobal?: string[] | undefined
  /** Skills already stored at global scope (for dedup across scopes). */
  existingGlobalSkills?: string[] | undefined
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
 *
 * The reflector may return one skill in addition to memories. A skill is a
 * procedural SOP — a reusable multi-step operation — worth materializing as
 * a file-backed asset. Skills are rare: most batches produce only memories.
 */
export function reflectionPrompt(turns: Turn[], context: ReflectionContext): string {
  const body = turns
    .map((turn, index) => `--- turn ${index + 1} ---\nUser:\n${turn.user}\n\nAssistant:\n${turn.assistant}\n\nTools: ${(turn.tools ?? []).join(', ')}`)
    .join('\n\n')
  const known = context.existing.length
    ? `\n\nMemory titles already stored in this scope. Reuse a title verbatim to correct or extend that memory; list a title under "evict" only when these turns prove it wrong. Never restate one under a new title:\n${context.existing.map(title => `- ${title}`).join('\n')}`
    : ''
  const knownSkills = context.existingSkills.length
    ? `\n\nSkills already stored in this scope. Reuse a name verbatim to update that skill:\n${context.existingSkills.map(name => `- ${name}`).join('\n')}`
    : ''
  const globalTitles = context.existingGlobal?.length
    ? `\n\nGlobal memory titles (do NOT create a project-scoped duplicate of these):\n${context.existingGlobal.map(title => `- ${title}`).join('\n')}`
    : ''
  const globalSkills = context.existingGlobalSkills?.length
    ? `\n\nGlobal skills (do NOT create a project-scoped duplicate of these):\n${context.existingGlobalSkills.map(name => `- ${name}`).join('\n')}`
    : ''
  return `Extract only durable, reusable memory from these ${turns.length} completed agent turn(s). Do not save transient task state, guesses, secrets, credentials, or raw logs.

Prefer what recurs across turns: a pit stepped into more than once, a convention confirmed again, an operating path that took shape. One-off details of a single task are not durable, however true they are — a topic merely explained at length is not durable either.

Return at most ${context.cap} memories, and prefer fewer. Return an empty memories array when nothing is durable; that is the normal outcome for an ordinary turn.

## Scope Routing

When unsure about scope, default to project scope (the current working directory). Only use global scope for truly universal facts that apply across ALL projects. Skip creating a project-scoped memory if the same title already exists at global scope — the global one takes precedence.

## Skills

In addition to memories, you may return ONE skill (or null) when the batch reveals a reusable multi-step procedure worth saving as an SOP. A skill is rarer than a memory — most batches produce none.

A skill has:
- \`name\`: kebab-case identifier (e.g. "git-commit-workflow", "run-tests-with-coverage")
- \`body\`: an object with five sections:
  - \`purpose\`: what this skill accomplishes (1-2 sentences)
  - \`trigger\`: when to use it, including explicit "don't use when..." lines
  - \`steps\`: anchored step-by-step instructions (numbered, concrete)
  - \`check\`: falsifiable verification — how to know it worked
  - \`reflex\`: (optional) automatic response pattern if any

Return skill only when the batch shows a procedure that:
1. Spans multiple steps or tools
2. Would benefit from explicit documentation
3. Is likely to recur in future work

Skills follow the same scope routing rule: default to project scope unless clearly global. Skip creating a project skill if the same name exists globally.

Return JSON only:
{"memories":[{"kind":"fact|preference|constraint|procedure","title":"short stable key","content":"concise durable value","tags":["tag"],"confidence":0.0}],"evict":["title of a stored memory these turns disproved"],"skill":null}

or with a skill:
{"memories":[...],"evict":[...],"skill":{"name":"kebab-case-name","body":{"purpose":"...","trigger":"...","steps":"...","check":"...","reflex":"..."}}}${known}${knownSkills}${globalTitles}${globalSkills}

${body}`
}

export function consolidationPrompt(items: MemoryItem[]): string {
  return `Consolidate these memories. Merge duplicates, resolve contradictions in favor of newer and higher-confidence evidence, and preserve distinct durable facts. Never invent information. Return JSON only with the same {"memories":[...]} shape.\n\n${JSON.stringify(items)}`
}
