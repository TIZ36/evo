import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import type { MemoryItem, MemoryScope, SkillItem, SkillBody } from '../../src/core/types.js'
import {
  formatCatalog,
  memoriesToCatalogEntries,
  mergeSkillsWithDisk,
  skillsToCatalogEntries,
  type CatalogResult,
} from '../../src/hook/catalog.js'
import { skillItemToSummary } from '../../src/workspace/skill-discovery.js'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'evo-catalog-'))
  return root
}

const globalScope: MemoryScope = { type: 'global' }
const projectScope: MemoryScope = { type: 'project', id: '/test-project' }

const makeSkillBody = (name: string): SkillBody => ({
  purpose: `Purpose of ${name}`,
  trigger: `When to use ${name}`,
  steps: `1. Step one\n2. Step two\n3. Step three`,
  check: `Verify ${name} worked`,
})

const validSkillMd = `# Test Skill

## Purpose

Do something useful.

## When to use

When you need this skill.

## Steps

1. First step
2. Second step
3. Third step

## Verification

Check the output.
`

describe('mergeSkillsWithDisk', () => {
  let cwd: string

  beforeEach(() => {
    cwd = fixture()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('returns database skills when no disk skills exist', () => {
    const dbSkills: SkillItem[] = [
      {
        name: 'db-skill',
        scope: globalScope,
        body: makeSkillBody('db-skill'),
        usageCount: 5,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: true,
      },
    ]

    const result = mergeSkillsWithDisk(dbSkills, cwd, false)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('db-skill')
    expect(result[0]!.source).toBe('evo')
  })

  it('includes disk-discovered skills not in database', () => {
    mkdirSync(join(cwd, '.claude/skills/disk-only'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/disk-only/SKILL.md'), validSkillMd)

    const result = mergeSkillsWithDisk([], cwd, false)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('disk-only')
    expect(result[0]!.source).toBe('disk')
  })

  it('deduplicates by (scope_key, path) when database skill has matching path', () => {
    const relPath = '.claude/skills/shared-skill/SKILL.md'
    mkdirSync(join(cwd, '.claude/skills/shared-skill'), { recursive: true })
    writeFileSync(join(cwd, relPath), validSkillMd)

    const dbSkills: SkillItem[] = [
      {
        name: 'shared-skill',
        scope: { type: 'project', id: cwd },
        body: makeSkillBody('shared-skill'),
        usageCount: 3,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
        source: { runtime: 'disk-hydrate', path: relPath },
      },
    ]

    const result = mergeSkillsWithDisk(dbSkills, cwd, false)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('shared-skill')
    expect(result[0]!.usageCount).toBe(3)
  })

  it('includes Chinese/Unicode skill names', () => {
    mkdirSync(join(cwd, '.claude/skills/素材分析'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/素材分析/SKILL.md'), '# 素材分析\n\n分析广告素材')

    const result = mergeSkillsWithDisk([], cwd, false)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('素材分析')
  })

  it('same-named skills in different directories both appear (dedup by scope+path, not name)', () => {
    mkdirSync(join(cwd, '.claude/skills/build'), { recursive: true })
    mkdirSync(join(cwd, '.codex/skills/build'), { recursive: true })
    mkdirSync(join(cwd, '.paper/agents/skills/build'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/build/SKILL.md'), '# Build (Claude)\n\n## When to use\n\nClaude build.')
    writeFileSync(join(cwd, '.codex/skills/build/SKILL.md'), '# Build (Codex)\n\n## When to use\n\nCodex build.')
    writeFileSync(join(cwd, '.paper/agents/skills/build/SKILL.md'), '# Build (Paper)\n\n## When to use\n\nPaper build.')

    const result = mergeSkillsWithDisk([], cwd, false)
    expect(result).toHaveLength(3)
    const paths = result.map(r => r.path).sort()
    expect(paths).toEqual([
      '.claude/skills/build/SKILL.md',
      '.codex/skills/build/SKILL.md',
      '.paper/agents/skills/build/SKILL.md',
    ])
    expect(result.every(r => r.name === 'build')).toBe(true)
  })

  it('same-named db skill and disk skills with different paths all survive', () => {
    mkdirSync(join(cwd, '.claude/skills/build'), { recursive: true })
    mkdirSync(join(cwd, '.codex/skills/build'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/build/SKILL.md'), '# Build (Claude)\n\n## When to use\n\nClaude build.')
    writeFileSync(join(cwd, '.codex/skills/build/SKILL.md'), '# Build (Codex)\n\n## When to use\n\nCodex build.')

    const dbSkills: SkillItem[] = [
      {
        name: 'build',
        scope: { type: 'project', id: cwd },
        body: makeSkillBody('build'),
        usageCount: 5,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: true,
      },
    ]

    const result = mergeSkillsWithDisk(dbSkills, cwd, false)
    expect(result.length).toBe(3)
    expect(result.filter(r => r.name === 'build')).toHaveLength(3)
    const sources = result.map(r => r.source).sort()
    expect(sources).toContain('evo')
    expect(sources).toContain('disk')
  })
})

describe('skillsToCatalogEntries', () => {
  it('converts skill summaries to catalog entries', () => {
    const skills: SkillItem[] = [
      {
        name: 'test-skill',
        scope: globalScope,
        body: makeSkillBody('test-skill'),
        usageCount: 10,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: true,
      },
    ]
    const summaries = skills.map(s => skillItemToSummary(s))
    const entries = skillsToCatalogEntries(summaries)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.type).toBe('skill')
    expect(entries[0]!.name).toBe('test-skill')
    expect(entries[0]!.scope).toBe('global')
    expect(entries[0]!.promoted).toBe(true)
    expect(entries[0]!.usageCount).toBe(10)
  })

  it('formats project scope with path', () => {
    const home = homedir()
    const projectPath = `${home}/projects/my-project`
    const skills: SkillItem[] = [
      {
        name: 'project-skill',
        scope: { type: 'project', id: projectPath },
        body: makeSkillBody('project-skill'),
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
      },
    ]
    const summaries = skills.map(s => skillItemToSummary(s))
    const entries = skillsToCatalogEntries(summaries)

    expect(entries[0]!.scope).toBe('project:~/projects/my-project')
  })
})

describe('memoriesToCatalogEntries', () => {
  it('converts memories to catalog entries', () => {
    const memories: MemoryItem[] = [
      {
        id: 'm1',
        scope: globalScope,
        kind: 'fact',
        title: 'Project uses TypeScript',
        content: 'All source files are .ts files with strict mode enabled.',
        tags: [],
        usageCount: 5,
        createdAt: 1000,
        updatedAt: 1000,
        source: { runtime: 'evo' },
      },
    ]
    const entries = memoriesToCatalogEntries(memories)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.type).toBe('memory')
    expect(entries[0]!.name).toBe('Project uses TypeScript')
    expect(entries[0]!.description).toContain('strict mode')
    expect(entries[0]!.scope).toBe('global')
    expect(entries[0]!.source).toBe('evo')
    expect(entries[0]!.usageCount).toBe(5)
  })

  it('includes source path for imported memories', () => {
    const memories: MemoryItem[] = [
      {
        id: 'm2',
        scope: projectScope,
        kind: 'constraint',
        title: 'Build constraints',
        content: 'Always run pnpm check before pushing',
        tags: ['workspace-import'],
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        source: { runtime: 'workspace-import', path: '/project/.paper/MEMORY.md' },
      },
    ]
    const entries = memoriesToCatalogEntries(memories)

    expect(entries[0]!.path).toBe('/project/.paper/MEMORY.md')
    expect(entries[0]!.source).toBe('workspace-import')
  })

  it('truncates long content descriptions', () => {
    const longContent = 'A'.repeat(200)
    const memories: MemoryItem[] = [
      {
        id: 'm3',
        scope: globalScope,
        kind: 'fact',
        title: 'Long memory',
        content: longContent,
        tags: [],
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]
    const entries = memoriesToCatalogEntries(memories)

    expect(entries[0]!.description.length).toBeLessThanOrEqual(80)
    expect(entries[0]!.description).toContain('...')
  })
})

describe('formatCatalog', () => {
  it('formats empty catalog', () => {
    const result: CatalogResult = { skills: [], memories: [] }
    const output = formatCatalog(result)

    expect(output).toContain('## Skills')
    expect(output).toContain('(none)')
    expect(output).toContain('## Memory')
  })

  it('formats skills section only', () => {
    const result: CatalogResult = {
      skills: [
        {
          type: 'skill',
          name: 'git-commit',
          description: 'When committing changes',
          path: '.claude/skills/git-commit/SKILL.md',
          scope: 'global',
          source: 'disk',
          usageCount: 5,
          promoted: true,
          dormant: false,
        },
      ],
      memories: [],
    }
    const output = formatCatalog(result, 'skills')

    expect(output).toContain('## Skills')
    expect(output).toContain('git-commit')
    expect(output).toContain('[promoted]')
    expect(output).toContain('(disk)')
    expect(output).toContain('.claude/skills/git-commit/SKILL.md')
    expect(output).not.toContain('## Memory')
  })

  it('formats memory section only', () => {
    const result: CatalogResult = {
      skills: [],
      memories: [
        {
          type: 'memory',
          name: 'Build process',
          description: 'Run pnpm check before committing',
          path: '',
          scope: 'project:/test',
          source: 'evo',
          usageCount: 10,
        },
      ],
    }
    const output = formatCatalog(result, 'memory')

    expect(output).toContain('## Memory')
    expect(output).toContain('Build process')
    expect(output).toContain('pnpm check')
    expect(output).toContain('project:/test')
    expect(output).not.toContain('## Skills')
  })

  it('sorts promoted skills first, then by usage count', () => {
    const result: CatalogResult = {
      skills: [
        { type: 'skill', name: 'low-use', description: '', path: '', scope: 'global', source: 'evo', usageCount: 1, promoted: false, dormant: false },
        { type: 'skill', name: 'high-use', description: '', path: '', scope: 'global', source: 'evo', usageCount: 10, promoted: false, dormant: false },
        { type: 'skill', name: 'promoted', description: '', path: '', scope: 'global', source: 'evo', usageCount: 5, promoted: true, dormant: false },
      ],
      memories: [],
    }
    const output = formatCatalog(result, 'skills')
    const lines = output.split('\n')
    const skillLines = lines.filter(l => l.includes('- ')).map(l => l.trim())

    expect(skillLines[0]).toContain('promoted')
    expect(skillLines[1]).toContain('high-use')
    expect(skillLines[2]).toContain('low-use')
  })

  it('marks dormant skills', () => {
    const result: CatalogResult = {
      skills: [
        { type: 'skill', name: 'dormant-skill', description: '', path: '', scope: 'global', source: 'evo', usageCount: 0, promoted: false, dormant: true },
      ],
      memories: [],
    }
    const output = formatCatalog(result, 'skills')

    expect(output).toContain('[dormant]')
  })

  it('produces no emoji badges or cards', () => {
    const result: CatalogResult = {
      skills: [
        { type: 'skill', name: 'test', description: 'Test skill', path: '/path', scope: 'global', source: 'evo', usageCount: 5, promoted: true, dormant: false },
      ],
      memories: [
        { type: 'memory', name: 'Test memory', description: 'Test content', path: '', scope: 'global', source: 'evo', usageCount: 3 },
      ],
    }
    const output = formatCatalog(result)

    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
    expect(emojiPattern.test(output)).toBe(false)
    expect(output).not.toContain('┌')
    expect(output).not.toContain('│')
    expect(output).not.toContain('└')
  })
})
