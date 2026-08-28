import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import type { SkillStore } from '../core/contracts.js'
import type { MemoryScope, SkillBody, SkillItem } from '../core/types.js'
import { parseSkillContent, SKILL_BASES } from './skill-discovery.js'
import { stripFrontmatter } from './importer.js'

export type SkillHydrateResult = {
  scope: MemoryScope
  files: number
  created: number
  updated: number
  unchanged: number
  skipped: boolean
}

export type SkillHydratorOptions = {
  now?: () => number
}

const MAX_DEPTH = 8
const MAX_FILES = 500

/**
 * Hydrator for on-disk SKILL.md files into the skills table.
 *
 * Unlike WorkspaceImporter (which imports skills as memories), this hydrates
 * skills into the proper skills table so they appear alongside evo-created skills.
 *
 * Human-written skills (from .claude/skills, .codex/skills, etc.) are marked with
 * source.runtime = 'disk-import' and are NOT evictable by evo reflection.
 */
export class SkillHydrator {
  private readonly now: () => number
  private hydratedScopes = new Set<string>()

  constructor(private readonly store: SkillStore, options: SkillHydratorOptions = {}) {
    this.now = options.now ?? Date.now
  }

  /**
   * Hydrate on-disk SKILL.md files from a project directory into the skills table.
   * Scans all SKILL_BASES directories (including .paper/agents/skills).
   *
   * Skills are upserted by name. Human-written skills (non-.paper/agents/skills)
   * are never overwritten by evo; .paper/agents/skills can be updated by evo.
   */
  async hydrateProject(cwd: string, options: { force?: boolean } = {}): Promise<SkillHydrateResult> {
    const scope: MemoryScope = { type: 'project', id: cwd }
    const scopeKey = `project:${cwd}`

    if (!options.force && this.hydratedScopes.has(scopeKey)) {
      return { scope, files: 0, created: 0, updated: 0, unchanged: 0, skipped: true }
    }

    const existing = await this.store.listSkills({ scopes: [scope], limit: 1000, includeDormant: true })
    const existingByName = new Map(existing.map(s => [s.name.toLowerCase(), s]))

    const discovered = this.discoverSkillFiles(cwd)
    let created = 0
    let updated = 0
    let unchanged = 0

    for (const { name, abs, rel, isEvoOwned } of discovered) {
      const raw = readFileSafe(abs)
      if (!raw) continue
      const content = stripFrontmatter(raw).trim()
      if (!content) continue

      const parsed = parseSkillContent(content)
      if (!parsed?.purpose || !parsed?.trigger || !parsed?.steps || !parsed?.check) {
        continue
      }
      const body: SkillBody = {
        purpose: parsed.purpose,
        trigger: parsed.trigger,
        steps: parsed.steps,
        check: parsed.check,
        ...(parsed.reflex ? { reflex: parsed.reflex } : {}),
      }

      const nameKey = name.toLowerCase()
      const old = existingByName.get(nameKey)
      const now = this.now()
      const source = { runtime: isEvoOwned ? 'disk-hydrate' : 'disk-import', path: abs }

      if (old) {
        const oldIsHuman = !isEvoOwned && old.source?.runtime === 'disk-import'
        const contentSame = JSON.stringify(old.body) === JSON.stringify(body)
        if (contentSame) {
          unchanged += 1
          continue
        }
        if (oldIsHuman && old.source?.runtime !== 'disk-import') {
          unchanged += 1
          continue
        }
        const item: SkillItem = {
          ...old,
          body,
          updatedAt: now,
          source,
        }
        await this.store.putSkill(item)
        updated += 1
      } else {
        const item: SkillItem = {
          name,
          scope,
          body,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
          source,
          dormant: false,
        }
        await this.store.putSkill(item)
        created += 1
      }
    }

    this.hydratedScopes.add(scopeKey)
    return { scope, files: discovered.length, created, updated, unchanged, skipped: false }
  }

  /**
   * Hydrate global skill files from $HOME into the global scope.
   */
  async hydrateGlobal(options: { force?: boolean } = {}): Promise<SkillHydrateResult> {
    const scope: MemoryScope = { type: 'global' }
    const scopeKey = 'global'

    if (!options.force && this.hydratedScopes.has(scopeKey)) {
      return { scope, files: 0, created: 0, updated: 0, unchanged: 0, skipped: true }
    }

    const home = homedir()
    const existing = await this.store.listSkills({ scopes: [scope], limit: 1000, includeDormant: true })
    const existingByName = new Map(existing.map(s => [s.name.toLowerCase(), s]))

    const discovered = this.discoverSkillFiles(home)
    let created = 0
    let updated = 0
    let unchanged = 0

    for (const { name, abs, rel } of discovered) {
      const raw = readFileSafe(abs)
      if (!raw) continue
      const content = stripFrontmatter(raw).trim()
      if (!content) continue

      const parsed = parseSkillContent(content)
      if (!parsed?.purpose || !parsed?.trigger || !parsed?.steps || !parsed?.check) {
        continue
      }
      const body: SkillBody = {
        purpose: parsed.purpose,
        trigger: parsed.trigger,
        steps: parsed.steps,
        check: parsed.check,
        ...(parsed.reflex ? { reflex: parsed.reflex } : {}),
      }

      const nameKey = name.toLowerCase()
      const old = existingByName.get(nameKey)
      const now = this.now()
      const source = { runtime: 'disk-import', path: abs }

      if (old) {
        const contentSame = JSON.stringify(old.body) === JSON.stringify(body)
        if (contentSame) {
          unchanged += 1
          continue
        }
        const item: SkillItem = {
          ...old,
          body,
          updatedAt: now,
          source,
        }
        await this.store.putSkill(item)
        updated += 1
      } else {
        const item: SkillItem = {
          name,
          scope,
          body,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
          source,
          dormant: false,
        }
        await this.store.putSkill(item)
        created += 1
      }
    }

    this.hydratedScopes.add(scopeKey)
    return { scope, files: discovered.length, created, updated, unchanged, skipped: false }
  }

  private discoverSkillFiles(root: string): Array<{ name: string; abs: string; rel: string; isEvoOwned: boolean }> {
    const seen = new Set<string>()
    const discovered: Array<{ name: string; abs: string; rel: string; isEvoOwned: boolean }> = []

    for (const { base } of SKILL_BASES) {
      const dir = join(root, base)
      if (!isDirectory(dir)) continue
      const isEvoOwned = base === '.paper/agents/skills'

      for (const abs of collectSkillMd(dir)) {
        const key = fileIdentity(abs) ?? abs
        if (seen.has(key)) continue
        seen.add(key)

        const rel = relative(root, abs).split(sep).join('/')
        const name = extractSkillName(rel)
        if (!name || !isValidSkillName(name)) continue

        discovered.push({ name, abs, rel, isEvoOwned })
      }
    }

    return discovered
  }
}

function extractSkillName(path: string): string {
  const parts = path.split('/')
  const skillMdIdx = parts.findIndex(p => p.toLowerCase() === 'skill.md')
  if (skillMdIdx > 0) return parts[skillMdIdx - 1]!
  return ''
}

function isValidSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
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

function fileIdentity(path: string): string | null {
  try {
    const stat = statSync(path)
    return `${stat.dev}:${stat.ino}`
  } catch {
    return null
  }
}
