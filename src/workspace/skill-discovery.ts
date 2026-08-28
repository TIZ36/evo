import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import type { MemoryItem, MemoryScope, SkillBody, SkillItem } from '../core/types.js'
import { stripFrontmatter } from './importer.js'

/** Summary returned by the skills API for display in the Skills tab. */
export type SkillSummary = {
  name: string
  trigger: string
  usageCount: number
  promoted: boolean
  dormant: boolean
  path: string
  source: 'evo' | 'human' | 'disk'
  scope: MemoryScope
}

/** Skill directories relative to a root (project or home). */
export const SKILL_BASES = [
  { base: '.claude/skills', tool: 'claude' },
  { base: '.codex/skills', tool: 'codex' },
  { base: '.copilot/skills', tool: 'copilot' },
  { base: '.agent/skills', tool: 'agent' },
  { base: '.paper/skills', tool: 'paper' },
  { base: '.paper/agents/skills', tool: 'paper-agents' },
] as const

/** Global skill directories under $HOME. */
export const HOME_SKILL_BASES = SKILL_BASES.map(b => b.base)

const MAX_DEPTH = 8
const MAX_FILES = 500

/**
 * Convert a SkillItem (from skills table) to a SkillSummary.
 */
export function skillItemToSummary(skill: SkillItem, basePath = '.paper/agents/skills'): SkillSummary {
  return {
    name: skill.name,
    trigger: extractTriggerSummary(skill.body.trigger),
    usageCount: skill.usageCount,
    promoted: skill.promoted ?? false,
    dormant: skill.dormant ?? false,
    path: `${basePath}/${skill.name}/SKILL.md`,
    source: 'evo',
    scope: skill.scope,
  }
}

/** Threshold for a memory-based skill to be considered "promoted" (high usage). */
const MEMORY_PROMOTED_THRESHOLD = 5

/**
 * Convert a MemoryItem (imported skill) to a SkillSummary.
 */
export function memoryItemToSummary(memory: MemoryItem): SkillSummary | null {
  if (memory.kind !== 'skill') return null
  const parsed = parseSkillContent(memory.content)
  return {
    name: extractSkillName(memory.title),
    trigger: parsed ? extractTriggerSummary(parsed.trigger ?? '') : truncate(memory.content, 80),
    usageCount: memory.usageCount,
    promoted: memory.usageCount >= MEMORY_PROMOTED_THRESHOLD,
    dormant: false,
    path: memory.title,
    source: 'human',
    scope: memory.scope,
  }
}

/**
 * Discover on-disk SKILL.md files in a directory and return summaries.
 * These are files that exist on disk but may not be in the database yet.
 */
export function discoverSkillFiles(root: string, scope: MemoryScope): Array<{ summary: SkillSummary; abs: string }> {
  const results: Array<{ summary: SkillSummary; abs: string }> = []
  for (const { base } of SKILL_BASES) {
    const dir = join(root, base)
    if (!isDirectory(dir)) continue
    for (const abs of collectSkillMd(dir)) {
      const rel = relative(root, abs).split(sep).join('/')
      const content = readFileSafe(abs)
      if (!content) continue
      const parsed = parseSkillContent(stripFrontmatter(content))
      results.push({
        summary: {
          name: extractSkillName(rel),
          trigger: parsed ? extractTriggerSummary(parsed.trigger ?? '') : '',
          usageCount: 0,
          promoted: false,
          dormant: false,
          path: rel,
          source: 'disk',
          scope,
        },
        abs,
      })
    }
  }
  return results
}

/**
 * Discover global (home directory) skill files.
 */
export function discoverGlobalSkillFiles(): Array<{ summary: SkillSummary; abs: string }> {
  const home = homedir()
  const scope: MemoryScope = { type: 'global' }
  const results: Array<{ summary: SkillSummary; abs: string }> = []
  for (const { base } of SKILL_BASES) {
    const dir = join(home, base)
    if (!isDirectory(dir)) continue
    for (const abs of collectSkillMd(dir)) {
      const rel = relative(home, abs).split(sep).join('/')
      const content = readFileSafe(abs)
      if (!content) continue
      const parsed = parseSkillContent(stripFrontmatter(content))
      results.push({
        summary: {
          name: extractSkillName(rel),
          trigger: parsed ? extractTriggerSummary(parsed.trigger ?? '') : '',
          usageCount: 0,
          promoted: false,
          dormant: false,
          path: `~/${rel}`,
          source: 'disk',
          scope,
        },
        abs,
      })
    }
  }
  return results
}

/**
 * Parse SKILL.md content to extract sections.
 */
export function parseSkillContent(content: string): Partial<SkillBody> | null {
  if (!content.trim()) return null
  const sections: Partial<SkillBody> = {}
  const lines = content.split('\n')
  let currentSection: keyof SkillBody | null = null
  let currentContent: string[] = []

  const flushSection = () => {
    if (currentSection && currentContent.length) {
      sections[currentSection] = currentContent.join('\n').trim()
    }
    currentContent = []
  }

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)$/i)
    if (sectionMatch) {
      flushSection()
      const heading = sectionMatch[1]!.toLowerCase().trim()
      if (heading === 'purpose') currentSection = 'purpose'
      else if (heading === 'when to use' || heading === 'trigger') currentSection = 'trigger'
      else if (heading === 'steps') currentSection = 'steps'
      else if (heading === 'verification' || heading === 'check') currentSection = 'check'
      else if (heading === 'reflex') currentSection = 'reflex'
      else currentSection = null
    } else if (currentSection) {
      currentContent.push(line)
    }
  }
  flushSection()
  return Object.keys(sections).length ? sections : null
}

/**
 * Extract skill name from a file path like `.claude/skills/git-workflow/SKILL.md`.
 */
function extractSkillName(path: string): string {
  const parts = path.split('/')
  const skillMdIdx = parts.findIndex(p => p.toLowerCase() === 'skill.md')
  if (skillMdIdx > 0) return parts[skillMdIdx - 1]!
  return parts[parts.length - 2] ?? parts[parts.length - 1] ?? 'unknown'
}

function extractTriggerSummary(trigger: string, maxLen = 80): string {
  const firstLine = trigger.split('\n')[0] ?? trigger
  const cleaned = firstLine.replace(/^[-*]\s*/, '').trim()
  return truncate(cleaned, maxLen)
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen - 3)}...`
}

function collectSkillMd(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string, depth: number) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(join(current, entry.name), depth + 1)
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        out.push(join(current, entry.name))
      }
    }
  }
  walk(dir, 0)
  return out
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
