import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { SkillHydrator } from '../../src/workspace/skill-hydrator.js'
import type { MemoryScope } from '../../src/core/types.js'

let counter = 0

function fixture(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'evo-skill-hydrator-')), 'project')
  mkdirSync(root, { recursive: true })
  return root
}

function makeStore(): { store: SqliteMemoryStore; close: () => void } {
  const path = join(tmpdir(), `evo-skill-hydrator-db-${++counter}.db`)
  const s = new SqliteMemoryStore(path)
  return { store: s, close: () => s.close() }
}

const validSkillMd = `# Test Skill

## Purpose

Test skill purpose.

## When to use

When testing skill hydration.

## Steps

1. Run the test
2. Verify results

## Verification

Test passes successfully.
`

describe('SkillHydrator', () => {
  it('hydrates SKILL.md files from .claude/skills into skills table', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.claude/skills/test-skill'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/test-skill/SKILL.md'), validSkillMd)

    const { store, close } = makeStore()
    try {
      const hydrator = new SkillHydrator(store)
      const result = await hydrator.hydrateProject(cwd)

      expect(result.skipped).toBe(false)
      expect(result.files).toBe(1)
      expect(result.created).toBe(1)
      expect(result.updated).toBe(0)
      expect(result.unchanged).toBe(0)

      const scope: MemoryScope = { type: 'project', id: cwd }
      const skill = await store.getSkill(scope, 'test-skill')
      expect(skill).not.toBeNull()
      expect(skill!.name).toBe('test-skill')
      expect(skill!.body.purpose).toContain('Test skill purpose')
      expect(skill!.body.trigger).toContain('When testing skill hydration')
      expect(skill!.source?.runtime).toBe('disk-import')
    } finally {
      close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('hydrates SKILL.md files from .paper/agents/skills as evo-owned', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.paper/agents/skills/evo-skill'), { recursive: true })
    writeFileSync(join(cwd, '.paper/agents/skills/evo-skill/SKILL.md'), validSkillMd)

    const { store, close } = makeStore()
    try {
      const hydrator = new SkillHydrator(store)
      const result = await hydrator.hydrateProject(cwd)

      expect(result.created).toBe(1)

      const scope: MemoryScope = { type: 'project', id: cwd }
      const skill = await store.getSkill(scope, 'evo-skill')
      expect(skill).not.toBeNull()
      expect(skill!.source?.runtime).toBe('disk-hydrate')
    } finally {
      close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('skips already-hydrated scope unless force is set', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.claude/skills/test-skill'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/test-skill/SKILL.md'), validSkillMd)

    const { store, close } = makeStore()
    try {
      const hydrator = new SkillHydrator(store)
      const first = await hydrator.hydrateProject(cwd)
      expect(first.skipped).toBe(false)
      expect(first.created).toBe(1)

      const second = await hydrator.hydrateProject(cwd)
      expect(second.skipped).toBe(true)
      expect(second.created).toBe(0)

      const forced = await hydrator.hydrateProject(cwd, { force: true })
      expect(forced.skipped).toBe(false)
      expect(forced.unchanged).toBe(1)
    } finally {
      close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('updates existing skills when content changes', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.claude/skills/test-skill'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/test-skill/SKILL.md'), validSkillMd)

    const { store, close } = makeStore()
    try {
      const hydrator = new SkillHydrator(store)
      await hydrator.hydrateProject(cwd)

      const updatedSkillMd = validSkillMd.replace('Test skill purpose', 'Updated purpose')
      writeFileSync(join(cwd, '.claude/skills/test-skill/SKILL.md'), updatedSkillMd)

      const result = await hydrator.hydrateProject(cwd, { force: true })
      expect(result.updated).toBe(1)
      expect(result.created).toBe(0)

      const scope: MemoryScope = { type: 'project', id: cwd }
      const skill = await store.getSkill(scope, 'test-skill')
      expect(skill!.body.purpose).toContain('Updated purpose')
    } finally {
      close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('creates skills from incomplete SKILL.md files with fallback content', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.claude/skills/incomplete'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/incomplete/SKILL.md'), `# Incomplete

## Purpose

Only has purpose.
`)

    const { store, close } = makeStore()
    try {
      const hydrator = new SkillHydrator(store)
      const result = await hydrator.hydrateProject(cwd)

      expect(result.files).toBe(1)
      expect(result.created).toBe(1)

      const scope: MemoryScope = { type: 'project', id: cwd }
      const skill = await store.getSkill(scope, 'incomplete')
      expect(skill).not.toBeNull()
      expect(skill!.body.purpose).toContain('Only has purpose')
      expect(skill!.body.trigger).toBeTruthy()
      expect(skill!.body.steps).toBeTruthy()
      expect(skill!.body.check).toBeTruthy()
    } finally {
      close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('hydrates skills from multiple directories', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.claude/skills/skill-a'), { recursive: true })
    mkdirSync(join(cwd, '.codex/skills/skill-b'), { recursive: true })
    mkdirSync(join(cwd, '.paper/agents/skills/skill-c'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/skill-a/SKILL.md'), validSkillMd)
    writeFileSync(join(cwd, '.codex/skills/skill-b/SKILL.md'), validSkillMd)
    writeFileSync(join(cwd, '.paper/agents/skills/skill-c/SKILL.md'), validSkillMd)

    const { store, close } = makeStore()
    try {
      const hydrator = new SkillHydrator(store)
      const result = await hydrator.hydrateProject(cwd)

      expect(result.files).toBe(3)
      expect(result.created).toBe(3)

      const scope: MemoryScope = { type: 'project', id: cwd }
      const skills = await store.listSkills({ scopes: [scope] })
      expect(skills).toHaveLength(3)
    } finally {
      close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('discovers non-kebab-case names but skips storing in table', async () => {
    const cwd = fixture()
    mkdirSync(join(cwd, '.claude/skills/InvalidName'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/InvalidName/SKILL.md'), validSkillMd)

    const { store, close } = makeStore()
    try {
      const hydrator = new SkillHydrator(store)
      const result = await hydrator.hydrateProject(cwd)

      expect(result.files).toBe(1)
      expect(result.created).toBe(0)

      const scope: MemoryScope = { type: 'project', id: cwd }
      const skill = await store.getSkill(scope, 'InvalidName')
      expect(skill).toBeNull()
    } finally {
      close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
