import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MemoryItem } from '../../src/core/types.js'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { stripFrontmatter, WorkspaceImporter } from '../../src/workspace/importer.js'


function fixture(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'evo-import-')), 'project')
  mkdirSync(root, { recursive: true })
  return root
}

/** A fresh directory per store: a fixed tmp path outlives the run, so the next
 *  revision reopens a file the previous one wrote — a schema change then shows
 *  up as a phantom failure on a developer machine that CI never reproduces. */
function makeStore(): { store: SqliteMemoryStore; close: () => void } {
  const path = join(mkdtempSync(join(tmpdir(), 'evo-import-db')), 'memory.db')
  const s = new SqliteMemoryStore(path)
  return { store: s, close: () => s.close() }
}

function imported(store: SqliteMemoryStore, cwd: string): Promise<MemoryItem[]> {
  return store.list({ scopes: [{ type: 'project', id: cwd }], tags: ['workspace-import'] })
}

describe('stripFrontmatter', () => {
  it('removes a leading YAML block', () => {
    expect(stripFrontmatter('---\nname: x\n---\nbody')).toBe('body')
  })

  it('leaves text without frontmatter untouched', () => {
    expect(stripFrontmatter('plain body')).toBe('plain body')
  })
})

describe('WorkspaceImporter', () => {
  it('imports known agent files with kinds, tags, and source paths', async () => {
    const cwd = fixture()
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Project\n\nRules here')
    writeFileSync(join(cwd, 'AGENTS.md'), 'Always lint before commit')
    mkdirSync(join(cwd, '.claude/skills/git-workflow'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/git-workflow/SKILL.md'), '---\nname: git-workflow\n---\n\n# Git Workflow\n\nUse conventional commits')
    mkdirSync(join(cwd, '.claude/commands'), { recursive: true })
    writeFileSync(join(cwd, '.claude/commands/commit.md'), 'Run: git commit')
    mkdirSync(join(cwd, '.codex'), { recursive: true })
    writeFileSync(join(cwd, '.codex/instructions.md'), 'Use pnpm')
    mkdirSync(join(cwd, '.copilot/instructions'), { recursive: true })
    writeFileSync(join(cwd, '.copilot/instructions/coding.md'), 'Prefer zod')
    mkdirSync(join(cwd, '.paper/skills/review'), { recursive: true })
    writeFileSync(join(cwd, '.paper/skills/review/SKILL.md'), '# Review\n\nCheck types')
    writeFileSync(join(cwd, '.paper/AGENT_MEMORY.md'), 'Team uses squash merges')
    writeFileSync(join(cwd, 'notes.txt'), 'not markdown')

    const { store, close } = makeStore()
    try {
      const importer = new WorkspaceImporter(store)
      const result = await importer.import(cwd)
      expect(result).toMatchObject({ skipped: false, files: 6, created: 6, updated: 0, unchanged: 0, pruned: 0 })

      const items = await imported(store, cwd)
      expect(items).toHaveLength(6)
      const byTitle = new Map(items.map(item => [item.title, item]))
      expect(byTitle.get('CLAUDE.md')?.kind).toBe('fact')
      expect(byTitle.get('CLAUDE.md')?.tags).toEqual(['workspace-import', 'tool:claude'])
      expect(byTitle.get('CLAUDE.md')?.source).toMatchObject({ runtime: 'workspace-import', path: join(cwd, 'CLAUDE.md') })
      expect(byTitle.get('AGENTS.md')?.kind).toBe('constraint')
      expect(byTitle.get('.claude/commands/commit.md')?.kind).toBe('procedure')
      expect(byTitle.get('.codex/instructions.md')?.kind).toBe('constraint')
      expect(byTitle.get('.copilot/instructions/coding.md')?.kind).toBe('constraint')
      expect(byTitle.get('.paper/AGENT_MEMORY.md')?.kind).toBe('fact')
      // Skill packages are the disk-skill catalog's, listed as one line each at
      // recall time. A memory row would quote the whole body instead.
      expect(byTitle.has('.claude/skills/git-workflow/SKILL.md')).toBe(false)
      expect(byTitle.has('.paper/skills/review/SKILL.md')).toBe(false)
    } finally {
      close()
    }
  })

  it('never imports a SKILL.md, wherever it sits', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.codex/plugins/browser/skills/control'), { recursive: true })
    writeFileSync(join(cwd, '.codex/plugins/browser/skills/control/SKILL.md'), '# Control\n\nDrive the browser')
    mkdirSync(join(cwd, '.paper/agents/skills/verify'), { recursive: true })
    writeFileSync(join(cwd, '.paper/agents/skills/verify/SKILL.md'), '# Verify\n\nEvo owns this one')
    const { store, close } = makeStore()
    try {
      const result = await new WorkspaceImporter(store).import(cwd)
      expect(result.created).toBe(0)
      expect(await imported(store, cwd)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('does not descend into tool cache directories', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.codex/.tmp/bundled-marketplaces/latex'), { recursive: true })
    writeFileSync(join(cwd, '.codex/.tmp/bundled-marketplaces/latex/guide.md'), 'vendored plugin doc')
    mkdirSync(join(cwd, '.agent/node_modules/pkg'), { recursive: true })
    writeFileSync(join(cwd, '.agent/node_modules/pkg/readme.md'), 'third-party readme')
    writeFileSync(join(cwd, '.codex/instructions.md'), 'Use pnpm')
    const { store, close } = makeStore()
    try {
      const result = await new WorkspaceImporter(store).import(cwd)
      expect(result.created).toBe(1)
      const titles = (await imported(store, cwd)).map(item => item.title)
      expect(titles).toEqual(['.codex/instructions.md'])
    } finally {
      close()
    }
  })

  it('skips an already-imported scope unless forced, and updates changed files on force', async () => {
    const cwd = fixture()
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Project\n\nOld rules')
    const { store, close } = makeStore()
    try {
      const importer = new WorkspaceImporter(store)
      await importer.import(cwd)

      const skipped = await importer.import(cwd)
      expect(skipped).toMatchObject({ skipped: true, created: 0, updated: 0 })

      writeFileSync(join(cwd, 'CLAUDE.md'), '# Project\n\nNew rules')
      const forced = await importer.import(cwd, { force: true })
      expect(forced).toMatchObject({ skipped: false, created: 0, updated: 1, unchanged: 0 })

      const items = await imported(store, cwd)
      expect(items.find(item => item.title === 'CLAUDE.md')?.content).toBe('# Project\n\nNew rules')
      expect(items).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('prunes imported items whose files disappeared', async () => {
    const cwd = fixture()
    writeFileSync(join(cwd, 'AGENTS.md'), 'Rules')
    const { store, close } = makeStore()
    try {
      const importer = new WorkspaceImporter(store)
      await importer.import(cwd)
      rmSync(join(cwd, 'AGENTS.md'))
      const result = await importer.import(cwd, { force: true })
      expect(result).toMatchObject({ created: 0, pruned: 1 })
      expect(await imported(store, cwd)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('prunes by source runtime, so an evo memory carrying the import tag survives', async () => {
    const cwd = fixture()
    writeFileSync(join(cwd, 'AGENTS.md'), 'Rules')
    const { store, close } = makeStore()
    try {
      const importer = new WorkspaceImporter(store)
      await importer.import(cwd)
      // Evo distils a memory *about* importing, and tags it accordingly. It has
      // no file behind it — pruning by tag would delete it.
      await store.put({
        id: 'own-1',
        scope: { type: 'project', id: cwd },
        kind: 'fact',
        title: 'workspace import never deletes user rules',
        content: 'The importer only owns rows it wrote.',
        tags: ['workspace-import'],
        usageCount: 0,
        createdAt: 1,
        updatedAt: 1,
        source: { runtime: 'evo' },
      })
      rmSync(join(cwd, 'AGENTS.md'))
      const result = await importer.import(cwd, { force: true })
      expect(result.pruned).toBe(1)
      const items = await imported(store, cwd)
      expect(items.map(item => item.id)).toEqual(['own-1'])
    } finally {
      close()
    }
  })

  it('ignores empty content, supporting docs in skill dirs, and .memory.md files', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.agent'), { recursive: true })
    writeFileSync(join(cwd, '.agent/empty.md'), '---\nname: empty\n---\n\n  ')
    mkdirSync(join(cwd, '.claude/skills/git-workflow'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/git-workflow/notes.md'), 'supporting doc')
    writeFileSync(join(cwd, '.claude/skills/git-workflow/.memory.md'), 'skill-level experience')
    const { store, close } = makeStore()
    try {
      const importer = new WorkspaceImporter(store)
      const result = await importer.import(cwd)
      expect(result.created).toBe(0)
      expect(await imported(store, cwd)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('isolates imports by workspace scope', async () => {
    const first = fixture()
    const second = fixture()
    writeFileSync(join(first, 'CLAUDE.md'), 'A')
    writeFileSync(join(second, 'CLAUDE.md'), 'B')
    const { store, close } = makeStore()
    try {
      const importer = new WorkspaceImporter(store)
      await importer.import(first)
      await importer.import(second)
      const firstItems = await imported(store, first)
      const secondItems = await imported(store, second)
      expect(firstItems).toHaveLength(1)
      expect(secondItems).toHaveLength(1)
      expect(firstItems[0]?.content).toBe('A')
      expect(secondItems[0]?.content).toBe('B')
    } finally {
      close()
    }
  })
})
