import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EvoService, type ReflectResult } from '../../src/core/evo.js'
import type { MemoryItem, MemoryScope, SkillBody, SkillItem } from '../../src/core/types.js'
import type { MemoryStore, ModelRunner, SkillStore } from '../../src/core/contracts.js'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { buildCatalogEntries, materializeSkill, renderLessonsMarkdown, renderSkillMarkdown, setCredentialSkipLogger, SKILL_ROOT, updateCatalog } from '../../src/workspace/skill-materializer.js'

class MemoryStoreStub implements MemoryStore {
  rows = new Map<string, MemoryItem>()
  async get(id: string) { return this.rows.get(id) ?? null }
  async list() { return [...this.rows.values()] }
  async put(item: MemoryItem) { this.rows.set(item.id, item) }
  async delete(id: string) { this.rows.delete(id) }
  async replace(scope: MemoryScope, items: MemoryItem[]) {
    for (const [id, row] of this.rows) if (JSON.stringify(row.scope) === JSON.stringify(scope)) this.rows.delete(id)
    for (const row of items) this.rows.set(row.id, row)
  }
  async count(scope: MemoryScope) {
    return [...this.rows.values()].filter(r => JSON.stringify(r.scope) === JSON.stringify(scope)).length
  }
  async incrementMemoryUsage(id: string) {
    const item = this.rows.get(id)
    if (item) { item.usageCount += 1; this.rows.set(id, item) }
  }
}

const scope: MemoryScope = { type: 'project', id: '/repo' }

const makeSkillBody = (name: string): SkillBody => ({
  purpose: `Purpose of ${name}`,
  trigger: `When to use ${name}`,
  steps: `1. Step one\n2. Step two\n3. Step three`,
  check: `Verify ${name} worked`,
  reflex: `Reflex pattern for ${name}`,
})

const runner = (response: unknown): ModelRunner => ({ complete: async () => JSON.stringify(response) })

function fixture(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'evo-skill-')), 'project')
  mkdirSync(root, { recursive: true })
  return root
}

function makeStore(): { store: SqliteMemoryStore; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'evo-skill-db-'))
  const path = join(dir, 'evo.db')
  const s = new SqliteMemoryStore(path)
  return { store: s, close: () => { s.close(); rmSync(dir, { recursive: true, force: true }) } }
}

describe('Skill types and storage', () => {
  it('stores and retrieves a skill', async () => {
    const { store, close } = makeStore()
    try {
      const skill: SkillItem = {
        name: 'git-commit-workflow',
        scope,
        body: makeSkillBody('git-commit'),
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        source: { runtime: 'evo' },
        dormant: false,
        promoted: false,
      }
      await store.putSkill(skill)
      const retrieved = await store.getSkill(scope, 'git-commit-workflow')
      expect(retrieved).toMatchObject({ name: 'git-commit-workflow', body: skill.body })
    } finally {
      close()
    }
  })

  it('increments usage count', async () => {
    const { store, close } = makeStore()
    try {
      const skill: SkillItem = {
        name: 'test-skill',
        scope,
        body: makeSkillBody('test'),
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
      }
      await store.putSkill(skill)
      await store.incrementUsage(scope, 'test-skill')
      await store.incrementUsage(scope, 'test-skill')
      const retrieved = await store.getSkill(scope, 'test-skill')
      expect(retrieved?.usageCount).toBe(2)
    } finally {
      close()
    }
  })

  it('stores and retrieves lessons', async () => {
    const { store, close } = makeStore()
    try {
      const skill: SkillItem = {
        name: 'skill-with-lessons',
        scope,
        body: makeSkillBody('lesson-test'),
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
      }
      await store.putSkill(skill)
      await store.addLesson(scope, 'skill-with-lessons', { text: 'First lesson', createdAt: 2000 })
      await store.addLesson(scope, 'skill-with-lessons', { text: 'Second lesson', createdAt: 3000, sessionId: 's1', turn: 5 })
      const lessons = await store.getLessons(scope, 'skill-with-lessons')
      expect(lessons).toHaveLength(2)
      expect(lessons[0]?.text).toBe('First lesson')
      expect(lessons[1]?.text).toBe('Second lesson')
      expect(lessons[1]?.sessionId).toBe('s1')
    } finally {
      close()
    }
  })

  it('cascades lesson deletion when skill is deleted', async () => {
    const { store, close } = makeStore()
    try {
      const skill: SkillItem = {
        name: 'deletable-skill',
        scope,
        body: makeSkillBody('delete-test'),
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
      }
      await store.putSkill(skill)
      await store.addLesson(scope, 'deletable-skill', { text: 'A lesson', createdAt: 2000 })
      await store.deleteSkill(scope, 'deletable-skill')
      const lessons = await store.getLessons(scope, 'deletable-skill')
      expect(lessons).toHaveLength(0)
    } finally {
      close()
    }
  })
})

describe('Skill reflection', () => {
  it('emits a skill from reflection when model returns one', async () => {
    const { store, close } = makeStore()
    try {
      const skillResponse = {
        memories: [],
        evict: [],
        skill: {
          name: 'deploy-workflow',
          body: makeSkillBody('deploy'),
        },
      }
      const service = new EvoService({
        store,
        skillStore: store,
        model: runner(skillResponse),
        now: () => 1000,
        id: () => 'm1',
      })

      const result = await service.reflectBatch([
        { sessionId: 's', turn: 1, scope, user: 'How do I deploy?', assistant: 'Here are the steps...' },
      ])

      expect(result.skill.created).not.toBeNull()
      expect(result.skill.created?.name).toBe('deploy-workflow')
      expect(result.skill.updated).toBeNull()

      const stored = await store.getSkill(scope, 'deploy-workflow')
      expect(stored).not.toBeNull()
      expect(stored?.body.purpose).toBe('Purpose of deploy')
    } finally {
      close()
    }
  })

  it('updates an existing skill when model returns same name', async () => {
    const { store, close } = makeStore()
    try {
      const existingSkill: SkillItem = {
        name: 'existing-skill',
        scope,
        body: makeSkillBody('old'),
        usageCount: 5,
        createdAt: 1000,
        updatedAt: 1000,
        source: { runtime: 'evo' },
        dormant: false,
        promoted: false,
      }
      await store.putSkill(existingSkill)

      const newBody = makeSkillBody('new')
      const skillResponse = {
        memories: [],
        evict: [],
        skill: { name: 'existing-skill', body: newBody },
      }
      const service = new EvoService({
        store,
        skillStore: store,
        model: runner(skillResponse),
        now: () => 2000,
        id: () => 'm1',
      })

      const result = await service.reflectBatch([
        { sessionId: 's', turn: 1, scope, user: 'update', assistant: 'done' },
      ])

      expect(result.skill.created).toBeNull()
      expect(result.skill.updated).not.toBeNull()
      expect(result.skill.updated?.name).toBe('existing-skill')

      const stored = await store.getSkill(scope, 'existing-skill')
      expect(stored?.body.purpose).toBe('Purpose of new')
      expect(stored?.usageCount).toBe(5)
    } finally {
      close()
    }
  })

  it('returns null skill when model returns null', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoService({
      store,
      model: runner({ memories: [], skill: null }),
      now: () => 1000,
    })

    const result = await service.reflectBatch([
      { sessionId: 's', turn: 1, scope, user: 'hello', assistant: 'world' },
    ])

    expect(result.skill.created).toBeNull()
    expect(result.skill.updated).toBeNull()
  })
})

describe('Skill materialization', () => {
  it('renders a skill as SKILL.md markdown', () => {
    const skill: SkillItem = {
      name: 'git-commit-workflow',
      scope,
      body: {
        purpose: 'Commit changes with proper messages',
        trigger: 'When you need to commit staged changes',
        steps: '1. Stage changes\n2. Write message\n3. Commit',
        check: 'git log shows the commit',
        reflex: 'Always verify before push',
      },
      usageCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: false,
      promoted: false,
    }
    const md = renderSkillMarkdown(skill)
    expect(md).toContain('# Git Commit Workflow')
    expect(md).toContain('## Purpose')
    expect(md).toContain('Commit changes with proper messages')
    expect(md).toContain('## When to use')
    expect(md).toContain('## Steps')
    expect(md).toContain('## Verification')
    expect(md).toContain('## Reflex')
  })

  it('renders lessons as .memory.md markdown', () => {
    const lessons = [
      { text: 'Always use -S flag', createdAt: Date.parse('2024-03-15') },
      { text: 'Check for merge conflicts first', createdAt: Date.parse('2024-03-16') },
    ]
    const md = renderLessonsMarkdown('git-commit-workflow', lessons)
    expect(md).toContain('# Lessons: Git Commit Workflow')
    expect(md).toContain('2024-03-15: Always use -S flag')
    expect(md).toContain('2024-03-16: Check for merge conflicts first')
  })

  it('materializes skill to disk', () => {
    const cwd = fixture()
    const skill: SkillItem = {
      name: 'test-skill',
      scope,
      body: makeSkillBody('test'),
      usageCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: false,
      promoted: false,
    }
    const lessons = [
      { text: 'Lesson one', createdAt: 2000 },
    ]

    const result = materializeSkill(cwd, skill, lessons)
    expect(result.written).toBe(true)
    expect(result.path).toBe(`${SKILL_ROOT}/test-skill`)

    const skillMd = readFileSync(join(cwd, SKILL_ROOT, 'test-skill', 'SKILL.md'), 'utf8')
    expect(skillMd).toContain('# Test Skill')
    expect(skillMd).toContain('Purpose of test')

    const memoryMd = readFileSync(join(cwd, SKILL_ROOT, 'test-skill', '.memory.md'), 'utf8')
    expect(memoryMd).toContain('Lesson one')
  })

  it('updates the catalog with skill entries', () => {
    const cwd = fixture()
    const entries = [
      { name: 'skill-one', trigger: 'When doing X', path: `${SKILL_ROOT}/skill-one` },
      { name: 'skill-two', trigger: 'When doing Y', path: `${SKILL_ROOT}/skill-two` },
    ]

    const result = updateCatalog(cwd, entries)
    expect(result.written).toBe(true)

    const catalog = readFileSync(join(cwd, '.paper/AGENT_MEMORY.md'), 'utf8')
    expect(catalog).toContain('## Learned Skills')
    expect(catalog).toContain('**skill-one**: When doing X')
    expect(catalog).toContain('**skill-two**: When doing Y')
  })

  it('builds catalog entries from skills', () => {
    const cwd = '/repo'
    const skills: SkillItem[] = [
      { name: 'git-commit', scope, body: { purpose: 'p', trigger: 'When committing code', steps: 's', check: 'c' }, usageCount: 0, createdAt: 1, updatedAt: 1, dormant: false, promoted: false },
    ]
    const entries = buildCatalogEntries(cwd, skills)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      name: 'git-commit',
      trigger: 'When committing code',
      path: `${SKILL_ROOT}/git-commit`,
    })
  })
})

describe('Skill recall', () => {
  it('includes skills in context as catalog entries, not full body', async () => {
    const { store, close } = makeStore()
    try {
      const skill: SkillItem = {
        name: 'deploy-workflow',
        scope,
        body: {
          purpose: 'Deploy application to production',
          trigger: 'When ready to deploy',
          steps: '1. Build\n2. Test\n3. Deploy\n4. Verify',
          check: 'Application is running',
        },
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
      }
      await store.putSkill(skill)

      const service = new EvoService({ store, skillStore: store })
      const context = await service.context({ scopes: [scope], maxChars: 6000 })

      expect(context).toContain('# Available skills')
      expect(context).toContain('**deploy-workflow**')
      expect(context).toContain('When ready to deploy')
      expect(context).toContain('.paper/agents/skills/deploy-workflow')
      expect(context).not.toContain('1. Build')
      expect(context).not.toContain('Deploy application to production')
    } finally {
      close()
    }
  })
})

describe('Skill usage tracking', () => {
  it('increments usage count and adds lessons via useSkill', async () => {
    const { store, close } = makeStore()
    try {
      const skill: SkillItem = {
        name: 'tracked-skill',
        scope,
        body: makeSkillBody('tracked'),
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
      }
      await store.putSkill(skill)

      const service = new EvoService({ store, skillStore: store, now: () => 2000 })
      await service.useSkill(scope, 'tracked-skill', 'This worked well')

      const updated = await store.getSkill(scope, 'tracked-skill')
      expect(updated?.usageCount).toBe(1)

      const lessons = await store.getLessons(scope, 'tracked-skill')
      expect(lessons).toHaveLength(1)
      expect(lessons[0]?.text).toBe('This worked well')
    } finally {
      close()
    }
  })
})

describe('Skill promotion by use', () => {
  it('promotes skill after reaching threshold uses', async () => {
    const { store, close } = makeStore()
    try {
      const skill: SkillItem = {
        name: 'promotable-skill',
        scope,
        body: makeSkillBody('promotable'),
        usageCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
      }
      await store.putSkill(skill)

      expect((await store.getSkill(scope, 'promotable-skill'))?.promoted).toBe(false)

      await store.incrementUsage(scope, 'promotable-skill')
      expect((await store.getSkill(scope, 'promotable-skill'))?.promoted).toBe(false)

      await store.incrementUsage(scope, 'promotable-skill')
      expect((await store.getSkill(scope, 'promotable-skill'))?.promoted).toBe(false)

      await store.incrementUsage(scope, 'promotable-skill')
      const promoted = await store.getSkill(scope, 'promotable-skill')
      expect(promoted?.usageCount).toBe(3)
      expect(promoted?.promoted).toBe(true)
    } finally {
      close()
    }
  })

  it('lists promoted skills first', async () => {
    const { store, close } = makeStore()
    try {
      const skill1: SkillItem = {
        name: 'zzz-last',
        scope,
        body: makeSkillBody('last'),
        usageCount: 10,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: false,
      }
      const skill2: SkillItem = {
        name: 'aaa-first',
        scope,
        body: makeSkillBody('first'),
        usageCount: 1,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: true,
      }
      await store.putSkill(skill1)
      await store.putSkill(skill2)

      const skills = await store.listSkills({ scopes: [scope] })
      expect(skills[0]?.name).toBe('aaa-first')
      expect(skills[0]?.promoted).toBe(true)
      expect(skills[1]?.name).toBe('zzz-last')
    } finally {
      close()
    }
  })

  it('includes promoted marker in context', async () => {
    const { store, close } = makeStore()
    try {
      const skill: SkillItem = {
        name: 'promoted-skill',
        scope,
        body: makeSkillBody('promoted'),
        usageCount: 5,
        createdAt: 1000,
        updatedAt: 1000,
        dormant: false,
        promoted: true,
      }
      await store.putSkill(skill)

      const service = new EvoService({ store, skillStore: store })
      const context = await service.context({ scopes: [scope], maxChars: 6000 })

      expect(context).toContain('**promoted-skill** ★')
    } finally {
      close()
    }
  })
})

describe('Imported skill protection', () => {
  it('does not evict imported skills from workspace', async () => {
    const store = new MemoryStoreStub()
    const service = new EvoService({
      store,
      model: runner({ memories: [], evict: ['imported-skill-file'] }),
      now: () => 1000,
    })

    store.rows.set('imported', {
      id: 'imported',
      scope,
      kind: 'skill',
      title: 'imported-skill-file',
      content: 'Imported skill content',
      tags: ['workspace-import'],
      usageCount: 0,
      createdAt: 1,
      updatedAt: 1,
      source: { runtime: 'workspace-import', path: '/repo/.claude/skills/test/SKILL.md' },
    })

    const result = await service.reflectBatch([
      { sessionId: 's', turn: 1, scope, user: 'test', assistant: 'done' },
    ])

    expect(result.memories.deleted).toEqual([])
    const remaining = await store.list()
    expect(remaining.map(m => m.id)).toContain('imported')
  })
})

describe('Credential skip on write', () => {
  it('skips materializing skill with credentials in body', () => {
    const cwd = fixture()
    const skill: SkillItem = {
      name: 'credential-skill',
      scope,
      body: {
        purpose: 'Deploy with secret key',
        trigger: 'When deploying',
        steps: '1. Set API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234\n2. Deploy',
        check: 'Check deployment succeeded',
      },
      usageCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: false,
      promoted: false,
    }

    const logs: string[] = []
    const restore = setCredentialSkipLogger((ctx) => { logs.push(ctx) })

    try {
      const result = materializeSkill(cwd, skill, [])
      expect(result.written).toBe(false)
      expect(result.skipReason).toBe('credential-detected')
      expect(result.credentialScan?.safe).toBe(false)
      expect(logs).toContain('skill/credential-skill/body')
    } finally {
      restore()
    }
  })

  it('skips materializing skill with credentials in lessons', () => {
    const cwd = fixture()
    const skill: SkillItem = {
      name: 'lesson-credential-skill',
      scope,
      body: makeSkillBody('test'),
      usageCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: false,
      promoted: false,
    }
    const lessons = [
      { text: 'Used ghp_1234567890abcdefghijklmnopqrstuvwxyzAB for auth', createdAt: 2000 },
    ]

    const logs: string[] = []
    const restore = setCredentialSkipLogger((ctx) => { logs.push(ctx) })

    try {
      const result = materializeSkill(cwd, skill, lessons)
      expect(result.written).toBe(false)
      expect(result.skipReason).toBe('credential-detected')
      expect(logs).toContain('skill/lesson-credential-skill/lessons')
    } finally {
      restore()
    }
  })

  it('allows skills with fixture/test credentials', () => {
    const cwd = fixture()
    const skill: SkillItem = {
      name: 'fixture-skill',
      scope,
      body: {
        purpose: 'Test API integration',
        trigger: 'When testing',
        steps: '1. Use test key sk-test-abc123def456ghi789jkl012mno345pqr678\n2. Run tests',
        check: 'Tests pass',
      },
      usageCount: 0,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: false,
      promoted: false,
    }

    const result = materializeSkill(cwd, skill, [])
    expect(result.written).toBe(true)
    expect(result.skipReason).toBeUndefined()
  })

  it('skips catalog update with credentials in entries', () => {
    const cwd = fixture()
    const entries = [
      { name: 'secret-skill', trigger: 'Use key sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234', path: '.paper/agents/skills/secret-skill' },
    ]

    const logs: string[] = []
    const restore = setCredentialSkipLogger((ctx) => { logs.push(ctx) })

    try {
      const result = updateCatalog(cwd, entries)
      expect(result.written).toBe(false)
      expect(result.skipReason).toBe('credential-detected')
      expect(logs).toContain('catalog')
    } finally {
      restore()
    }
  })
})
