import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { EvoService } from '../../src/core/evo.js'
import { renderMemoryContext } from '../../src/core/prompt.js'
import { checkSkillForm } from '../../src/core/skill-polish.js'
import { DEFAULT_RETENTION } from '../../src/core/consolidate.js'
import type { MemoryItem, MemoryScope, SkillItem } from '../../src/core/types.js'
import type { ModelRunner } from '../../src/core/contracts.js'

const scope: MemoryScope = { type: 'project', id: '/eval' }

function makeStore(): { store: SqliteMemoryStore; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'evo-eval-'))
  const path = join(dir, 'evo.db')
  const s = new SqliteMemoryStore(path)
  return { store: s, close: () => { s.close(); rmSync(dir, { recursive: true, force: true }) } }
}

const mockRunner = (response: unknown): ModelRunner => ({
  complete: async () => JSON.stringify(response),
})

describe('Eval: keep-fact', () => {
  it('a fact remains in store after creation', async () => {
    const { store, close } = makeStore()
    try {
      const service = new EvoService({ store, skillStore: store, events: store })

      const memory = await service.remember({
        scope,
        kind: 'fact',
        title: 'Project uses TypeScript',
        content: 'The evo project is written in TypeScript with strict mode enabled.',
      })

      const recalled = await store.list({ scopes: [scope] })
      const found = recalled.find(m => m.title === 'Project uses TypeScript')

      expect(found).toBeDefined()
      expect(found?.id).toBe(memory.id)
    } finally {
      close()
    }
  })
})

describe('Eval: update-fact', () => {
  it('reflecting with same title updates existing memory', async () => {
    const { store, close } = makeStore()
    try {
      const service = new EvoService({ store, skillStore: store, events: store })

      await service.remember({
        scope,
        kind: 'fact',
        title: 'Database engine',
        content: 'Uses SQLite for storage.',
      })

      service.setModelRunner(mockRunner({
        memories: [{
          kind: 'fact',
          title: 'Database engine',
          content: 'Uses SQLite with WAL mode for storage.',
        }],
      }))

      await service.reflectBatch([{
        sessionId: 's1',
        turn: 1,
        scope,
        user: 'Tell me about storage',
        assistant: 'It uses SQLite with WAL mode.',
      }])

      const recalled = await store.list({ scopes: [scope] })
      const matches = recalled.filter(m => m.title.toLowerCase().includes('database'))

      expect(matches).toHaveLength(1)
      expect(matches[0]?.content).toContain('WAL')
    } finally {
      close()
    }
  })
})

describe('Eval: skill-fidelity', () => {
  it('skill body sections are correctly stored and validated', async () => {
    const { store, close } = makeStore()
    try {
      const service = new EvoService({ store, skillStore: store, events: store })

      const skillBody = {
        purpose: 'Deploy the application to production environment',
        trigger: 'When ready to deploy after testing passes',
        steps: '1. Run tests\n2. Build artifacts\n3. Deploy to staging\n4. Verify\n5. Deploy to production',
        check: 'Application responds on production URL',
        reflex: 'Always check logs after deploy',
      }

      service.setModelRunner(mockRunner({
        memories: [],
        skill: { name: 'deploy-workflow', body: skillBody },
      }))

      await service.reflectBatch([{
        sessionId: 's1',
        turn: 1,
        scope,
        user: 'How do I deploy?',
        assistant: 'Here are the steps...',
      }])

      const skill = await store.getSkill(scope, 'deploy-workflow')
      expect(skill).toBeDefined()

      const formCheck = checkSkillForm(skill!)
      expect(formCheck.valid).toBe(true)
      expect(skill!.body.steps).toContain('1. Run tests')
    } finally {
      close()
    }
  })
})

describe('Eval: catalog-recall-size', () => {
  it('skills appear as compact catalog entries in recall context', async () => {
    const { store, close } = makeStore()
    try {
      const service = new EvoService({ store, skillStore: store, events: store })

      const longSteps = Array.from({ length: 20 }, (_, i) =>
        `${i + 1}. Step ${i + 1} with detailed description`
      ).join('\n')

      await store.putSkill({
        name: 'complex-workflow',
        scope,
        body: {
          purpose: 'A complex multi-step workflow',
          trigger: 'When doing complex things',
          steps: longSteps,
          check: 'All steps completed',
        },
        usageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dormant: false,
      })

      const context = await service.context({ scopes: [scope], maxChars: 6000 })

      expect(context).toContain('complex-workflow')
      expect(context).not.toContain('Step 10 with detailed')
    } finally {
      close()
    }
  })
})

describe('Eval: budget-cap', () => {
  it('store capacity is enforced via eviction', async () => {
    const { store, close } = makeStore()
    try {
      const retention = { ...DEFAULT_RETENTION, maxMemories: 5, newbornGraceDays: 0 }
      const service = new EvoService({ store, skillStore: store, events: store, retention })

      const now = Date.now()
      for (let i = 0; i < 10; i++) {
        await store.put({
          id: `m${i}`,
          scope,
          kind: 'fact',
          title: `Fact ${i}`,
          content: `Content ${i}`,
          tags: [],
          usageCount: i,
          createdAt: now - 10 * 24 * 60 * 60 * 1000,
          updatedAt: now - 10 * 24 * 60 * 60 * 1000,
          source: { runtime: 'evo' },
        })
      }

      const beforeCount = await store.count(scope)
      const evicted = await service.enforceCapacity(scope)
      const afterCount = await store.count(scope)

      expect(beforeCount).toBe(10)
      expect(afterCount).toBe(5)
      expect(evicted).toHaveLength(5)
    } finally {
      close()
    }
  })
})

describe('Eval: dormancy', () => {
  it('unused skills become dormant after threshold', async () => {
    const { store, close } = makeStore()
    try {
      const service = new EvoService({ store, skillStore: store, events: store })

      const now = Date.now()
      const oldDate = now - 30 * 24 * 60 * 60 * 1000

      await store.putSkill({
        name: 'old-unused',
        scope,
        body: { purpose: 'purpose text here', trigger: 'trigger text here', steps: '1. step one', check: 'check text here' },
        usageCount: 0,
        createdAt: oldDate,
        updatedAt: oldDate,
        dormant: false,
      })

      await store.putSkill({
        name: 'old-used',
        scope,
        body: { purpose: 'purpose text here', trigger: 'trigger text here', steps: '1. step one', check: 'check text here' },
        usageCount: 5,
        createdAt: oldDate,
        updatedAt: oldDate,
        dormant: false,
      })

      const madeDormant = await service.processDormancy(scope)

      expect(madeDormant).toContain('old-unused')

      const dormantSkill = await store.getSkill(scope, 'old-unused')
      const activeSkill = await store.getSkill(scope, 'old-used')

      expect(dormantSkill?.dormant).toBe(true)
      expect(activeSkill?.dormant).toBe(false)
    } finally {
      close()
    }
  })
})
