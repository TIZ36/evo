import { homedir } from 'node:os'
import { scopeKey, type MemoryItem, type MemoryScope, type SkillItem } from '../core/types.js'
import type { SkillSummary } from '../workspace/skill-discovery.js'
import {
  discoverSkillFiles,
  discoverGlobalSkillFiles,
  skillItemToSummary,
} from '../workspace/skill-discovery.js'

export type CatalogSection = 'skills' | 'memory' | 'all'

export type CatalogEntry = {
  type: 'skill' | 'memory'
  name: string
  description: string
  path: string
  scope: string
  source: string
  usageCount: number
  promoted?: boolean
  dormant?: boolean
}

export type CatalogResult = {
  skills: CatalogEntry[]
  memories: CatalogEntry[]
}

/**
 * Merge database skills with disk-discovered SKILL.md files.
 * Disk files not yet in the database appear as "disk" source.
 *
 * Deduplication uses (scope_key, path) so same-named skills in different
 * directories (e.g. .claude/skills/build and .codex/skills/build) both survive.
 * This matches the recall dedup logic in EvoService.context and EvoCordisService.skills.
 */
export function mergeSkillsWithDisk(
  dbSkills: SkillItem[],
  projectRoot?: string
): SkillSummary[] {
  const summaries: SkillSummary[] = []
  const seenKeys = new Set<string>()

  for (const skill of dbSkills) {
    const summary = skillItemToSummary(skill)
    const dedupKey = `${scopeKey(summary.scope)}:${summary.path.toLowerCase()}`
    seenKeys.add(dedupKey)
    summaries.push(summary)
  }

  const globalScope: MemoryScope = { type: 'global' }
  const globalDisk = discoverGlobalSkillFiles()
  for (const { summary } of globalDisk) {
    const dedupKey = `${scopeKey(globalScope)}:${summary.path.toLowerCase()}`
    if (seenKeys.has(dedupKey)) continue
    seenKeys.add(dedupKey)
    summaries.push(summary)
  }

  if (projectRoot) {
    const projectScope: MemoryScope = { type: 'project', id: projectRoot }
    const projectDisk = discoverSkillFiles(projectRoot, projectScope)
    for (const { summary } of projectDisk) {
      const dedupKey = `${scopeKey(projectScope)}:${summary.path.toLowerCase()}`
      if (seenKeys.has(dedupKey)) continue
      seenKeys.add(dedupKey)
      summaries.push(summary)
    }
  }

  return summaries
}

/**
 * Build catalog entries from skills.
 */
export function skillsToCatalogEntries(skills: SkillSummary[]): CatalogEntry[] {
  return skills.map(skill => ({
    type: 'skill' as const,
    name: skill.name,
    description: skill.trigger,
    path: skill.path,
    scope: formatScope(skill.scope),
    source: skill.source,
    usageCount: skill.usageCount,
    promoted: skill.promoted,
    dormant: skill.dormant,
  }))
}

/**
 * Build catalog entries from memories.
 */
export function memoriesToCatalogEntries(memories: MemoryItem[]): CatalogEntry[] {
  return memories.map(memory => ({
    type: 'memory' as const,
    name: memory.title,
    description: truncate(memory.content, 80),
    path: memory.source?.path ?? '',
    scope: formatScope(memory.scope),
    source: memory.source?.runtime ?? 'unknown',
    usageCount: memory.usageCount,
  }))
}

function formatScope(scope: MemoryScope): string {
  if (scope.type === 'global') return 'global'
  if (scope.type === 'project') {
    const id = scope.id ?? ''
    const home = homedir()
    if (id.startsWith(home + '/')) {
      return `project:~/${id.slice(home.length + 1)}`
    }
    return `project:${id}`
  }
  return `${scope.type}:${scope.id ?? ''}`
}

function truncate(text: string, maxLen: number): string {
  const firstLine = text.split('\n')[0] ?? text
  if (firstLine.length <= maxLen) return firstLine
  return `${firstLine.slice(0, maxLen - 3)}...`
}

/**
 * Format catalog entries as terminal-readable text.
 * Typographic, provenance visible, no emoji badges, no cards.
 */
export function formatCatalog(result: CatalogResult, section: CatalogSection = 'all'): string {
  const lines: string[] = []

  if (section === 'skills' || section === 'all') {
    lines.push('## Skills')
    lines.push('')
    if (result.skills.length === 0) {
      lines.push('  (none)')
    } else {
      const sorted = [...result.skills].sort((a, b) => {
        if (a.promoted && !b.promoted) return -1
        if (!a.promoted && b.promoted) return 1
        return b.usageCount - a.usageCount
      })
      for (const entry of sorted) {
        lines.push(formatSkillEntry(entry))
      }
    }
    lines.push('')
  }

  if (section === 'memory' || section === 'all') {
    lines.push('## Memory')
    lines.push('')
    if (result.memories.length === 0) {
      lines.push('  (none)')
    } else {
      const sorted = [...result.memories].sort((a, b) => b.usageCount - a.usageCount)
      for (const entry of sorted) {
        lines.push(formatMemoryEntry(entry))
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatSkillEntry(entry: CatalogEntry): string {
  const flags: string[] = []
  if (entry.promoted) flags.push('promoted')
  if (entry.dormant) flags.push('dormant')
  const flagStr = flags.length ? ` [${flags.join(', ')}]` : ''
  const sourceStr = entry.source !== 'evo' ? ` (${entry.source})` : ''
  
  return [
    `  - ${entry.name}${flagStr}${sourceStr}`,
    `    trigger: ${entry.description || '(no trigger)'}`,
    `    path: ${entry.path || '(in-memory)'}`,
    `    scope: ${entry.scope}, uses: ${entry.usageCount}`,
  ].join('\n')
}

function formatMemoryEntry(entry: CatalogEntry): string {
  const sourceStr = entry.source && entry.source !== 'evo' ? ` (${entry.source})` : ''
  const pathStr = entry.path ? `\n    path: ${entry.path}` : ''
  
  return [
    `  - ${entry.name}${sourceStr}`,
    `    ${entry.description}`,
    `    scope: ${entry.scope}, uses: ${entry.usageCount}${pathStr}`,
  ].join('\n')
}
