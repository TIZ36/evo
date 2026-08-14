import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { MemoryStore } from '../core/contracts.js'
import type { MemoryItem, MemoryKind, MemoryScope } from '../core/types.js'

export type WorkspaceImportResult = {
  scope: MemoryScope
  /** Number of candidate files discovered in the workspace. */
  files: number
  created: number
  updated: number
  unchanged: number
  /** True when the scope was already imported and `force` was not set. */
  skipped: boolean
}

export type WorkspaceImporterOptions = {
  now?: () => number
  id?: () => string
  /** Per-file content cap after frontmatter stripping. */
  maxContentChars?: number
}

const IMPORT_TAG = 'workspace-import'
const MAX_CONTENT_CHARS = 50_000
const MAX_FILES = 500
const MAX_DEPTH = 8

type Rule = { kind: MemoryKind; tool: string }

/**
 * Single-file workspace memory conventions. Root files are matched by exact
 * relative path; directory rules classify every `.md` found below their base.
 * Classification order matters: root files first, then skill packages (the
 * `skills/<name>/SKILL.md` convention), then generic directory rules.
 */
const ROOT_FILES: Record<string, Rule> = {
  'CLAUDE.md': { kind: 'fact', tool: 'claude' },
  '.claude/CLAUDE.md': { kind: 'fact', tool: 'claude' },
  'AGENTS.md': { kind: 'constraint', tool: 'agent' },
  'agents.md': { kind: 'constraint', tool: 'agent' },
  '.agent/AGENTS.md': { kind: 'constraint', tool: 'agent' },
  '.paper/AGENT_MEMORY.md': { kind: 'fact', tool: 'paper' },
}

const SKILL_BASES = [
  { base: '.claude/skills', tool: 'claude' },
  { base: '.codex/skills', tool: 'codex' },
  { base: '.copilot/skills', tool: 'copilot' },
  { base: '.agent/skills', tool: 'agent' },
  { base: '.paper/skills', tool: 'paper' },
  { base: '.paper/agents/skills', tool: 'paper' },
]

const DIR_RULES: Array<Rule & { base: string }> = [
  { base: '.claude/commands', kind: 'procedure', tool: 'claude' },
  { base: '.claude/agents', kind: 'procedure', tool: 'claude' },
  { base: '.copilot/instructions', kind: 'constraint', tool: 'copilot' },
  { base: '.copilot/prompts', kind: 'constraint', tool: 'copilot' },
  { base: '.codex', kind: 'constraint', tool: 'codex' },
  { base: '.agent', kind: 'constraint', tool: 'agent' },
  { base: '.paper', kind: 'fact', tool: 'paper' },
]

export class WorkspaceImporter {
  private readonly now: () => number
  private readonly id: () => string
  private readonly maxContentChars: number

  constructor(private readonly store: MemoryStore, options: WorkspaceImporterOptions = {}) {
    this.now = options.now ?? Date.now
    this.id = options.id ?? randomUUID
    this.maxContentChars = options.maxContentChars ?? MAX_CONTENT_CHARS
  }

  /**
   * Import project-local agent memory and skill files (`CLAUDE.md`, `AGENTS.md`,
   * `.claude/`, `.codex/`, `.copilot/`, `.agent/`, `.paper/`) into the given
   * workspace as project-scoped memories.
   *
   * Idempotent: items are upserted by `(scope, title)` where title is the file's
   * path relative to the workspace root. Files that disappeared are never
   * deleted, so user-reflected memories in the same scope are left untouched.
   * Unless `force` is set, a scope that already carries any `workspace-import`
   * tagged item is skipped without scanning.
   */
  async import(cwd: string, options: { force?: boolean } = {}): Promise<WorkspaceImportResult> {
    const scope: MemoryScope = { type: 'project', id: cwd }
    const existing = await this.store.list({ scopes: [scope], tags: [IMPORT_TAG], limit: 1000 })
    if (!options.force && existing.length > 0) {
      return { scope, files: 0, created: 0, updated: 0, unchanged: 0, skipped: true }
    }

    const discovered = this.discover(cwd)
    const byTitle = new Map(existing.map(item => [item.title.toLocaleLowerCase(), item]))
    let created = 0
    let updated = 0
    let unchanged = 0
    for (const { rel, abs, rule } of discovered) {
      const raw = readFileSafe(abs)
      if (raw === null) continue
      const content = stripFrontmatter(raw).slice(0, this.maxContentChars).trim()
      if (!content) continue
      const now = this.now()
      const old = byTitle.get(rel.toLocaleLowerCase())
      if (old) {
        if (old.content === content) {
          unchanged += 1
          continue
        }
        const item: MemoryItem = {
          ...old,
          content,
          updatedAt: now,
          tags: old.tags.includes(IMPORT_TAG) ? old.tags : [...old.tags, IMPORT_TAG],
          source: { runtime: 'workspace-import', path: abs },
        }
        await this.store.put(item)
        updated += 1
      } else {
        const item: MemoryItem = {
          id: this.id(),
          scope,
          kind: rule.kind,
          title: rel,
          content,
          tags: [IMPORT_TAG, `tool:${rule.tool}`],
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
          source: { runtime: 'workspace-import', path: abs },
        }
        await this.store.put(item)
        created += 1
      }
    }
    return { scope, files: discovered.length, created, updated, unchanged, skipped: false }
  }

  private discover(cwd: string): Array<{ rel: string; abs: string; rule: Rule }> {
    const seen = new Set<string>()
    const discovered: Array<{ rel: string; abs: string; rule: Rule }> = []
    const add = (abs: string) => {
      // Inode dedup survives case-insensitive filesystems (macOS APFS), where
      // AGENTS.md and agents.md resolve to the same file.
      const key = fileIdentity(abs) ?? abs
      if (seen.has(key)) return
      seen.add(key)
      const rel = relative(cwd, abs).split(sep).join('/')
      const rule = classify(rel)
      if (rule) discovered.push({ rel, abs, rule })
    }
    for (const rel of Object.keys(ROOT_FILES)) {
      const abs = join(cwd, rel)
      if (isFile(abs)) add(abs)
    }
    for (const { base } of SKILL_BASES) {
      const dir = join(cwd, base)
      if (!isDirectory(dir)) continue
      for (const abs of collectMarkdown(dir, 'SKILL.md')) add(abs)
    }
    for (const { base } of DIR_RULES) {
      const dir = join(cwd, base)
      if (!isDirectory(dir)) continue
      for (const abs of collectMarkdown(dir)) add(abs)
    }
    return discovered
  }
}

function classify(rel: string): Rule | null {
  const root = ROOT_FILES[rel]
  if (root) return root
  for (const { base, tool } of SKILL_BASES) {
    if (rel.startsWith(`${base}/`)) return { kind: 'skill', tool }
  }
  for (const { base, kind, tool } of DIR_RULES) {
    if (rel.startsWith(`${base}/`)) return { kind, tool }
  }
  return null
}

/**
 * Recursively collect `.md` files below `dir` (excluding `*.memory.md`, the
 * skill-level experience files that are not imported). When `onlyBasename` is
 * given, only files with that exact basename are kept (e.g. `SKILL.md`).
 */
function collectMarkdown(dir: string, onlyBasename?: string): string[] {
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
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.memory.md')) {
        if (onlyBasename && entry.name !== onlyBasename) continue
        out.push(join(current, entry.name))
      }
    }
  }
  walk(dir, 0)
  return out
}

/** Drop a leading YAML frontmatter block (`---` ... `---`) when present. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end < 0) return text
  let rest = text.slice(end + 4)
  if (rest.startsWith('\n')) rest = rest.slice(1)
  return rest
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Stable per-file identity (`dev:ino`) for deduplication across hard links and case variants. */
function fileIdentity(path: string): string | null {
  try {
    const stat = statSync(path)
    return `${stat.dev}:${stat.ino}`
  } catch {
    return null
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
