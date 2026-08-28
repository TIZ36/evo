import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SkillItem, SkillLesson } from '../core/types.js'
import type { SkillCatalogEntry } from '../core/prompt.js'
import { scanForCredentials, scanMultiple, type ScanResult } from '../core/credential-scan.js'

export type { SkillCatalogEntry } from '../core/prompt.js'

export type WriteSkipReason = 'credential-detected'

export type MaterializeResult = {
  written: boolean
  path: string
  skipReason?: WriteSkipReason
  credentialScan?: ScanResult
}

/** Log function for credential skip events. Override in tests. */
export let logCredentialSkip: (context: string, scan: ScanResult) => void = (context, scan) => {
  const matches = scan.matches.map(m => `${m.type}: ${m.preview}`).join(', ')
  console.warn(`[evo] credential skip (${context}): ${matches}`)
}

/** Override the credential skip logger (for testing). */
export function setCredentialSkipLogger(fn: typeof logCredentialSkip): () => void {
  const prev = logCredentialSkip
  logCredentialSkip = fn
  return () => { logCredentialSkip = prev }
}

/** Where evo-owned skills are written under a project's cwd. */
export const SKILL_ROOT = '.paper/agents/skills'

/** The catalog file where skill entries are listed. */
export const CATALOG_PATH = '.paper/AGENT_MEMORY.md'

/** Marker for the evo-managed skills section in the catalog. */
const CATALOG_SECTION_START = '<!-- evo:skills:start -->'
const CATALOG_SECTION_END = '<!-- evo:skills:end -->'

/**
 * Render a skill's body as SKILL.md content.
 *
 * Format:
 * ```
 * # <Name in Title Case>
 *
 * ## Purpose
 * <purpose>
 *
 * ## When to use
 * <trigger>
 *
 * ## Steps
 * <steps>
 *
 * ## Verification
 * <check>
 *
 * ## Reflex
 * <reflex>  (if present)
 * ```
 */
export function renderSkillMarkdown(skill: SkillItem): string {
  const title = skill.name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  let md = `# ${title}\n\n`
  md += `## Purpose\n\n${skill.body.purpose}\n\n`
  md += `## When to use\n\n${skill.body.trigger}\n\n`
  md += `## Steps\n\n${skill.body.steps}\n\n`
  md += `## Verification\n\n${skill.body.check}\n`
  if (skill.body.reflex) {
    md += `\n## Reflex\n\n${skill.body.reflex}\n`
  }
  return md
}

/**
 * Render lessons as .memory.md content.
 */
export function renderLessonsMarkdown(skillName: string, lessons: SkillLesson[]): string {
  if (!lessons.length) return ''
  const title = skillName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  let md = `# Lessons: ${title}\n\n`
  for (const lesson of lessons) {
    const date = new Date(lesson.createdAt).toISOString().split('T')[0]
    md += `- ${date}: ${lesson.text}\n`
  }
  return md
}

/**
 * Scan a skill body for credentials.
 */
export function scanSkillBody(skill: SkillItem): ScanResult {
  const texts = [
    skill.body.purpose,
    skill.body.trigger,
    skill.body.steps,
    skill.body.check,
    skill.body.reflex ?? '',
  ]
  return scanMultiple(texts)
}

/**
 * Scan lessons for credentials.
 */
export function scanLessons(lessons: SkillLesson[]): ScanResult {
  return scanMultiple(lessons.map(l => l.text))
}

/**
 * Materialize a skill to disk: SKILL.md + optional .memory.md.
 *
 * Scans content for credentials before writing. If credentials are detected,
 * the write is skipped and logged (no throw into user session).
 *
 * @returns MaterializeResult with write status and path.
 */
export function materializeSkill(cwd: string, skill: SkillItem, lessons: SkillLesson[] = []): MaterializeResult {
  const relativePath = join(SKILL_ROOT, skill.name)
  const skillDir = join(cwd, SKILL_ROOT, skill.name)

  const bodyScan = scanSkillBody(skill)
  if (!bodyScan.safe) {
    logCredentialSkip(`skill/${skill.name}/body`, bodyScan)
    return { written: false, path: relativePath, skipReason: 'credential-detected', credentialScan: bodyScan }
  }

  if (lessons.length) {
    const lessonScan = scanLessons(lessons)
    if (!lessonScan.safe) {
      logCredentialSkip(`skill/${skill.name}/lessons`, lessonScan)
      return { written: false, path: relativePath, skipReason: 'credential-detected', credentialScan: lessonScan }
    }
  }

  mkdirSync(skillDir, { recursive: true })

  const skillPath = join(skillDir, 'SKILL.md')
  writeFileSync(skillPath, renderSkillMarkdown(skill))

  if (lessons.length) {
    const memoryPath = join(skillDir, '.memory.md')
    writeFileSync(memoryPath, renderLessonsMarkdown(skill.name, lessons))
  }

  return { written: true, path: relativePath }
}

/**
 * Legacy wrapper for backward compatibility.
 * @deprecated Use materializeSkill which returns MaterializeResult.
 */
export function materializeSkillPath(cwd: string, skill: SkillItem, lessons: SkillLesson[] = []): string {
  const result = materializeSkill(cwd, skill, lessons)
  return result.path
}

export type CatalogUpdateResult = {
  written: boolean
  path: string
  skipReason?: WriteSkipReason
  credentialScan?: ScanResult
}

/**
 * Update the catalog with current skill entries.
 *
 * The catalog is a markdown file with a section managed by evo. If the section
 * markers don't exist, they are appended to the file.
 *
 * Scans entries for credentials before writing. If detected, skips and logs.
 */
export function updateCatalog(cwd: string, entries: SkillCatalogEntry[]): CatalogUpdateResult {
  const catalogPath = join(cwd, CATALOG_PATH)

  const entryScan = scanMultiple(entries.flatMap(e => [e.name, e.trigger, e.path]))
  if (!entryScan.safe) {
    logCredentialSkip('catalog', entryScan)
    return { written: false, path: CATALOG_PATH, skipReason: 'credential-detected', credentialScan: entryScan }
  }

  let content = ''
  try {
    content = readFileSync(catalogPath, 'utf8')
  } catch {
    mkdirSync(dirname(catalogPath), { recursive: true })
  }

  const section = renderCatalogSection(entries)

  if (content.includes(CATALOG_SECTION_START)) {
    const startIdx = content.indexOf(CATALOG_SECTION_START)
    const endIdx = content.indexOf(CATALOG_SECTION_END)
    if (endIdx > startIdx) {
      content = content.slice(0, startIdx) + section + content.slice(endIdx + CATALOG_SECTION_END.length)
    } else {
      content = content.slice(0, startIdx) + section
    }
  } else {
    content = content.trimEnd()
    if (content) content += '\n\n'
    content += section
  }

  writeFileSync(catalogPath, content)
  return { written: true, path: CATALOG_PATH }
}

function renderCatalogSection(entries: SkillCatalogEntry[]): string {
  if (!entries.length) {
    return `${CATALOG_SECTION_START}\n${CATALOG_SECTION_END}`
  }
  let section = `${CATALOG_SECTION_START}\n\n## Learned Skills\n\n`
  section += 'Skills evo has learned. Read the SKILL.md when you need to use one.\n\n'
  for (const entry of entries) {
    section += `- **${entry.name}**: ${entry.trigger} → \`${entry.path}/SKILL.md\`\n`
  }
  section += `\n${CATALOG_SECTION_END}`
  return section
}

/**
 * Build catalog entries from skills.
 */
export function buildCatalogEntries(cwd: string, skills: SkillItem[]): SkillCatalogEntry[] {
  return skills.map(skill => ({
    name: skill.name,
    trigger: extractTriggerSummary(skill.body.trigger),
    path: join(SKILL_ROOT, skill.name),
  }))
}

/**
 * Extract a one-line trigger summary from the full trigger text.
 */
function extractTriggerSummary(trigger: string, maxLen = 80): string {
  const firstLine = trigger.split('\n')[0] ?? trigger
  const cleaned = firstLine.replace(/^[-*]\s*/, '').trim()
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, maxLen - 3)}...`
}
