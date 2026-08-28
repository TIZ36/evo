import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import {
  discoverSkillFiles,
  memoryItemToSummary,
  parseSkillContent,
  skillItemToSummary,
} from '../../src/workspace/skill-discovery.js'
import type { MemoryItem, SkillBody, SkillItem, MemoryScope } from '../../src/core/types.js'

function fixture(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'evo-skill-discovery-')), 'project')
  mkdirSync(root, { recursive: true })
  return root
}

const scope: MemoryScope = { type: 'project', id: '/test-project' }

const makeSkillBody = (name: string): SkillBody => ({
  purpose: `Purpose of ${name}`,
  trigger: `When to use ${name}`,
  steps: `1. Step one\n2. Step two\n3. Step three`,
  check: `Verify ${name} worked`,
})

const validSkillMd = `# Git Commit Workflow

## Purpose

Commit changes safely following conventional commits.

## When to use

When you need to commit staged changes.
Don't use when: making an emergency hotfix.

## Steps

1. Stage your changes
2. Write a conventional commit message
3. Run pre-commit hooks
4. Push to remote

## Verification

The commit appears in git log with correct message format.

## Reflex

Always check for unstaged changes before committing.
`

describe('parseSkillContent', () => {
  it('parses a valid SKILL.md into sections', () => {
    const result = parseSkillContent(validSkillMd)
    expect(result).not.toBeNull()
    expect(result?.purpose).toContain('Commit changes safely')
    expect(result?.trigger).toContain('When you need to commit')
    expect(result?.steps).toContain('Stage your changes')
    expect(result?.check).toContain('git log')
    expect(result?.reflex).toContain('unstaged changes')
  })

  it('returns null for empty content', () => {
    expect(parseSkillContent('')).toBeNull()
    expect(parseSkillContent('   ')).toBeNull()
  })

  it('returns partial sections when some are missing', () => {
    const partial = `# Partial Skill

## Purpose

Do something useful.

## Steps

1. Do the thing
`
    const result = parseSkillContent(partial)
    expect(result?.purpose).toContain('Do something useful')
    expect(result?.steps).toContain('Do the thing')
    expect(result?.trigger).toBeUndefined()
    expect(result?.check).toBeUndefined()
  })
})

describe('skillItemToSummary', () => {
  it('converts a SkillItem to SkillSummary', () => {
    const skill: SkillItem = {
      name: 'git-commit',
      scope,
      body: makeSkillBody('git-commit'),
      usageCount: 10,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: false,
      promoted: true,
    }
    const summary = skillItemToSummary(skill)
    expect(summary.name).toBe('git-commit')
    expect(summary.trigger).toBe('When to use git-commit')
    expect(summary.usageCount).toBe(10)
    expect(summary.promoted).toBe(true)
    expect(summary.dormant).toBe(false)
    expect(summary.source).toBe('evo')
    expect(summary.path).toContain('git-commit/SKILL.md')
  })

  it('uses promoted field from skill, not calculated', () => {
    const skill: SkillItem = {
      name: 'new-skill',
      scope,
      body: makeSkillBody('new'),
      usageCount: 2,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: false,
      promoted: false,
    }
    const summary = skillItemToSummary(skill)
    expect(summary.promoted).toBe(false)
  })

  it('marks dormant skills correctly', () => {
    const skill: SkillItem = {
      name: 'dormant-skill',
      scope,
      body: makeSkillBody('dormant'),
      usageCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: true,
      promoted: false,
    }
    const summary = skillItemToSummary(skill)
    expect(summary.dormant).toBe(true)
  })
})

describe('memoryItemToSummary', () => {
  it('converts a skill memory to SkillSummary', () => {
    const memory: MemoryItem = {
      id: 'm1',
      scope,
      kind: 'skill',
      title: '.claude/skills/git-workflow/SKILL.md',
      content: validSkillMd,
      tags: ['workspace-import', 'tool:claude'],
      usageCount: 3,
      createdAt: 1000,
      updatedAt: 1000,
    }
    const summary = memoryItemToSummary(memory)
    expect(summary).not.toBeNull()
    expect(summary!.name).toBe('git-workflow')
    expect(summary!.trigger).toContain('When you need to commit')
    expect(summary!.usageCount).toBe(3)
    expect(summary!.source).toBe('human')
    expect(summary!.path).toBe('.claude/skills/git-workflow/SKILL.md')
  })

  it('returns null for non-skill memories', () => {
    const memory: MemoryItem = {
      id: 'm1',
      scope,
      kind: 'fact',
      title: 'Project uses TypeScript',
      content: 'All source files are .ts',
      tags: [],
      usageCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
    }
    expect(memoryItemToSummary(memory)).toBeNull()
  })
})

describe('discoverSkillFiles', () => {
  let cwd: string

  beforeEach(() => {
    cwd = fixture()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('discovers SKILL.md files from .claude/skills', () => {
    mkdirSync(join(cwd, '.claude/skills/git-commit'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/git-commit/SKILL.md'), validSkillMd)

    const results = discoverSkillFiles(cwd, scope)
    expect(results).toHaveLength(1)
    expect(results[0]!.summary.name).toBe('git-commit')
    expect(results[0]!.summary.source).toBe('disk')
    expect(results[0]!.summary.path).toBe('.claude/skills/git-commit/SKILL.md')
  })

  it('discovers skills from multiple skill directories', () => {
    mkdirSync(join(cwd, '.claude/skills/skill-a'), { recursive: true })
    mkdirSync(join(cwd, '.codex/skills/skill-b'), { recursive: true })
    mkdirSync(join(cwd, '.paper/agents/skills/skill-c'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/skill-a/SKILL.md'), validSkillMd)
    writeFileSync(join(cwd, '.codex/skills/skill-b/SKILL.md'), validSkillMd)
    writeFileSync(join(cwd, '.paper/agents/skills/skill-c/SKILL.md'), validSkillMd)

    const results = discoverSkillFiles(cwd, scope)
    expect(results).toHaveLength(3)
    const names = results.map(r => r.summary.name).sort()
    expect(names).toEqual(['skill-a', 'skill-b', 'skill-c'])
  })

  it('ignores non-SKILL.md files', () => {
    mkdirSync(join(cwd, '.claude/skills/test-skill'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/test-skill/SKILL.md'), validSkillMd)
    writeFileSync(join(cwd, '.claude/skills/test-skill/notes.md'), 'not a skill')
    writeFileSync(join(cwd, '.claude/skills/test-skill/.memory.md'), 'lessons learned')

    const results = discoverSkillFiles(cwd, scope)
    expect(results).toHaveLength(1)
    expect(results[0]!.summary.name).toBe('test-skill')
  })

  it('returns empty array when no skill directories exist', () => {
    const results = discoverSkillFiles(cwd, scope)
    expect(results).toHaveLength(0)
  })
})
