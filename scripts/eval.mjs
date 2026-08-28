#!/usr/bin/env node
/**
 * evo eval harness
 *
 * Runs a set of eval cases to verify memory and skill behavior.
 * Gate is "not worse than last", not all-green theater.
 *
 * Usage:
 *   node scripts/eval.mjs [--baseline] [--compare <baseline-file>]
 *
 * Options:
 *   --baseline   Output baseline JSON to stdout for later comparison
 *   --compare    Compare current run against a baseline file
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = join(__dirname, '..')

// Dynamic imports for the evo modules
const { SqliteMemoryStore } = await import(join(root, 'dist/storage/sqlite-store.js'))
const { EvoService } = await import(join(root, 'dist/core/evo.js'))
const { renderMemoryContext } = await import(join(root, 'dist/core/prompt.js'))
const { checkSkillForm } = await import(join(root, 'dist/core/skill-polish.js'))
const { DEFAULT_RETENTION } = await import(join(root, 'dist/core/consolidate.js'))

const scope = { type: 'project', id: '/eval' }

function createTestEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'evo-eval-'))
  const path = join(dir, 'evo.db')
  const store = new SqliteMemoryStore(path)
  const service = new EvoService({ store, skillStore: store, events: store })
  return {
    store,
    service,
    cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }) },
  }
}

// Mock model runner that returns predetermined responses
function mockRunner(response) {
  return { complete: async () => JSON.stringify(response) }
}

// ── Eval Cases ────────────────────────────────────────────────────────────────

const evalCases = []

// Case 1: Keep a fact - memory should persist through recall cycles
evalCases.push({
  name: 'keep-fact',
  description: 'A fact remains in store after creation',
  run: async () => {
    const { service, store, cleanup } = createTestEnv()
    try {
      const memory = await service.remember({
        scope,
        kind: 'fact',
        title: 'Project uses TypeScript',
        content: 'The evo project is written in TypeScript with strict mode enabled.',
      })

      const recalled = await store.list({ scopes: [scope] })
      const found = recalled.find(m => m.title === 'Project uses TypeScript')

      return {
        passed: !!found,
        details: { memoryId: memory.id, recalled: recalled.length },
      }
    } finally {
      cleanup()
    }
  },
})

// Case 2: Update a fact - same title should update, not duplicate
evalCases.push({
  name: 'update-fact',
  description: 'Reflecting with same title updates existing memory',
  run: async () => {
    const { service, store, cleanup } = createTestEnv()
    try {
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

      return {
        passed: matches.length === 1 && matches[0]?.content.includes('WAL'),
        details: { matchCount: matches.length, content: matches[0]?.content },
      }
    } finally {
      cleanup()
    }
  },
})

// Case 3: Skill body fidelity - skill structure is preserved
evalCases.push({
  name: 'skill-fidelity',
  description: 'Skill body sections are correctly stored and validated',
  run: async () => {
    const { service, store, cleanup } = createTestEnv()
    try {
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
      const formCheck = skill ? checkSkillForm(skill) : { valid: false, issues: ['skill not found'] }

      return {
        passed: !!skill && formCheck.valid && skill.body.steps.includes('1. Run tests'),
        details: {
          skillFound: !!skill,
          formValid: formCheck.valid,
          issues: formCheck.issues,
        },
      }
    } finally {
      cleanup()
    }
  },
})

// Case 4: Catalog recall stays small - skills are listed as catalog, not full body
evalCases.push({
  name: 'catalog-recall-size',
  description: 'Skills appear as compact catalog entries in recall context',
  run: async () => {
    const { service, store, cleanup } = createTestEnv()
    try {
      const longSteps = Array.from({ length: 20 }, (_, i) => `${i + 1}. Step ${i + 1} with detailed description`).join('\n')

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

      const contextIncludesSkillName = context.includes('complex-workflow')
      const contextIncludesFullSteps = context.includes('Step 10 with detailed')

      return {
        passed: contextIncludesSkillName && !contextIncludesFullSteps,
        details: {
          contextLength: context.length,
          hasSkillName: contextIncludesSkillName,
          hasFullSteps: contextIncludesFullSteps,
        },
      }
    } finally {
      cleanup()
    }
  },
})

// Case 5: Budget/cap enforcement - eviction happens when over capacity
evalCases.push({
  name: 'budget-cap',
  description: 'Store capacity is enforced via eviction',
  run: async () => {
    const { service, store, cleanup } = createTestEnv()
    try {
      const retention = { ...DEFAULT_RETENTION, maxMemories: 5, newbornGraceDays: 0 }
      const testService = new EvoService({ store, skillStore: store, events: store, retention })

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
      const evicted = await testService.enforceCapacity(scope)
      const afterCount = await store.count(scope)

      return {
        passed: beforeCount === 10 && afterCount === 5 && evicted.length === 5,
        details: { before: beforeCount, after: afterCount, evicted: evicted.length },
      }
    } finally {
      cleanup()
    }
  },
})

// Case 6: Dormancy - unused skills become dormant
evalCases.push({
  name: 'dormancy',
  description: 'Unused skills become dormant after threshold',
  run: async () => {
    const { service, store, cleanup } = createTestEnv()
    try {
      const now = Date.now()
      const oldDate = now - 30 * 24 * 60 * 60 * 1000

      await store.putSkill({
        name: 'old-unused',
        scope,
        body: { purpose: 'p', trigger: 't', steps: '1. s', check: 'c' },
        usageCount: 0,
        createdAt: oldDate,
        updatedAt: oldDate,
        dormant: false,
      })

      await store.putSkill({
        name: 'old-used',
        scope,
        body: { purpose: 'p', trigger: 't', steps: '1. s', check: 'c' },
        usageCount: 5,
        createdAt: oldDate,
        updatedAt: oldDate,
        dormant: false,
      })

      const madeDormant = await service.processDormancy(scope)
      const dormantSkill = await store.getSkill(scope, 'old-unused')
      const activeSkill = await store.getSkill(scope, 'old-used')

      return {
        passed: madeDormant.includes('old-unused') &&
                dormantSkill?.dormant === true &&
                activeSkill?.dormant === false,
        details: { madeDormant, dormantState: dormantSkill?.dormant, activeState: activeSkill?.dormant },
      }
    } finally {
      cleanup()
    }
  },
})

// ── Runner ────────────────────────────────────────────────────────────────────

async function runEval() {
  const results = []
  let passed = 0
  let failed = 0

  for (const evalCase of evalCases) {
    try {
      const result = await evalCase.run()
      results.push({
        name: evalCase.name,
        description: evalCase.description,
        ...result,
      })
      if (result.passed) {
        passed++
        console.log(`✓ ${evalCase.name}: ${evalCase.description}`)
      } else {
        failed++
        console.log(`✗ ${evalCase.name}: ${evalCase.description}`)
        console.log(`  Details: ${JSON.stringify(result.details)}`)
      }
    } catch (error) {
      failed++
      results.push({
        name: evalCase.name,
        description: evalCase.description,
        passed: false,
        error: error.message,
      })
      console.log(`✗ ${evalCase.name}: ${evalCase.description}`)
      console.log(`  Error: ${error.message}`)
    }
  }

  console.log(`\n${passed}/${evalCases.length} cases passed`)

  return { results, passed, failed, total: evalCases.length }
}

async function compareBaseline(baselinePath, current) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

  console.log('\n─── Baseline Comparison ───')

  let regressions = 0
  for (const baseCase of baseline.results) {
    const currCase = current.results.find(c => c.name === baseCase.name)
    if (!currCase) {
      console.log(`? ${baseCase.name}: missing in current run`)
      continue
    }
    if (baseCase.passed && !currCase.passed) {
      console.log(`↓ ${baseCase.name}: REGRESSION (was passing, now failing)`)
      regressions++
    } else if (!baseCase.passed && currCase.passed) {
      console.log(`↑ ${baseCase.name}: IMPROVEMENT (was failing, now passing)`)
    }
  }

  if (regressions > 0) {
    console.log(`\n⚠ ${regressions} regression(s) detected`)
    return false
  } else {
    console.log(`\n✓ No regressions (not worse than baseline)`)
    return true
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isBaseline = args.includes('--baseline')
const compareIdx = args.indexOf('--compare')
const comparePath = compareIdx !== -1 ? args[compareIdx + 1] : null

const current = await runEval()

if (isBaseline) {
  console.log('\n─── Baseline Output ───')
  console.log(JSON.stringify(current, null, 2))
}

if (comparePath) {
  const ok = await compareBaseline(comparePath, current)
  process.exit(ok ? 0 : 1)
}

process.exit(current.failed > 0 ? 1 : 0)
