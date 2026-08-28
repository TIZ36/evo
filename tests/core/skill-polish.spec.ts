import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { checkSkillForm, polishGuard, shouldBeDormant, processDormancy, DORMANCY_DAYS } from '../../src/core/skill-polish.js'
import type { MemoryScope, SkillBody, SkillItem } from '../../src/core/types.js'

const scope: MemoryScope = { type: 'project', id: '/repo' }

function makeStore(): { store: SqliteMemoryStore; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'evo-polish-'))
  const path = join(dir, 'evo.db')
  const s = new SqliteMemoryStore(path)
  return { store: s, close: () => { s.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function makeSkill(name: string, overrides: Partial<SkillItem> = {}): SkillItem {
  return {
    name,
    scope,
    body: {
      purpose: 'A valid purpose statement for the skill',
      trigger: 'When you need to do something specific',
      steps: '1. First step\n2. Second step\n3. Third step',
      check: 'Verify that the expected result occurred',
      reflex: 'Optional automatic response',
    },
    usageCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    dormant: false,
    ...overrides,
  }
}

describe('checkSkillForm', () => {
  it('validates a well-formed skill', () => {
    const skill = makeSkill('valid-skill')
    const result = checkSkillForm(skill)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('rejects non-kebab-case names', () => {
    const skill = makeSkill('InvalidName')
    const result = checkSkillForm(skill)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('name must be kebab-case')
  })

  it('rejects short purpose', () => {
    const skill = makeSkill('short-purpose', {
      body: { ...makeSkill('x').body, purpose: 'Short' },
    })
    const result = checkSkillForm(skill)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.includes('purpose'))).toBe(true)
  })

  it('rejects steps without numbered items', () => {
    const skill = makeSkill('no-steps', {
      body: { ...makeSkill('x').body, steps: 'Just some text without numbered items' },
    })
    const result = checkSkillForm(skill)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.includes('steps'))).toBe(true)
  })

  it('rejects short check', () => {
    const skill = makeSkill('short-check', {
      body: { ...makeSkill('x').body, check: 'OK' },
    })
    const result = checkSkillForm(skill)
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.includes('check'))).toBe(true)
  })

  it('accepts bulleted steps', () => {
    const skill = makeSkill('bulleted-steps', {
      body: { ...makeSkill('x').body, steps: '- First step\n- Second step\n- Third step' },
    })
    const result = checkSkillForm(skill)
    expect(result.valid).toBe(true)
  })
})

describe('polishGuard', () => {
  it('allows reasonable polish', () => {
    const original: SkillBody = {
      purpose: 'Original purpose',
      trigger: 'Original trigger',
      steps: '1. Step one\n2. Step two',
      check: 'Original check',
    }
    const polished: SkillBody = {
      purpose: 'Improved purpose',
      trigger: 'Improved trigger with lessons',
      steps: '1. Step one (improved)\n2. Step two\n3. Step three',
      check: 'Improved check',
    }
    const result = polishGuard(original, polished)
    expect(result.allowed).toBe(true)
  })

  it('rejects excessive step growth', () => {
    const original: SkillBody = {
      purpose: 'Original',
      trigger: 'Trigger',
      steps: '1. Step one\n2. Step two',
      check: 'Check',
    }
    const polished: SkillBody = {
      purpose: 'Original',
      trigger: 'Trigger',
      steps: '1. A\n2. B\n3. C\n4. D\n5. E\n6. F\n7. G',
      check: 'Check',
    }
    const result = polishGuard(original, polished)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('step count')
  })

  it('rejects invented absolute paths', () => {
    const original: SkillBody = {
      purpose: 'Original',
      trigger: 'Trigger',
      steps: '1. Do something',
      check: 'Check',
    }
    const polished: SkillBody = {
      purpose: 'Original',
      trigger: 'Trigger',
      steps: '1. Edit /opt/app/file.ts',
      check: 'Check',
    }
    const result = polishGuard(original, polished)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('absolute paths')
  })

  it('allows relative paths', () => {
    const original: SkillBody = {
      purpose: 'Original',
      trigger: 'Trigger',
      steps: '1. Edit ~/project/file.ts',
      check: 'Check',
    }
    const polished: SkillBody = {
      purpose: 'Original',
      trigger: 'Trigger',
      steps: '1. Edit ./src/file.ts',
      check: 'Check',
    }
    const result = polishGuard(original, polished)
    expect(result.allowed).toBe(true)
  })

  it('rejects too long reflex', () => {
    const original: SkillBody = {
      purpose: 'Original',
      trigger: 'Trigger',
      steps: '1. Step',
      check: 'Check',
    }
    const polished: SkillBody = {
      purpose: 'Original',
      trigger: 'Trigger',
      steps: '1. Step',
      check: 'Check',
      reflex: 'x'.repeat(600),
    }
    const result = polishGuard(original, polished)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('reflex')
  })
})

describe('shouldBeDormant', () => {
  it('returns false for used skills', () => {
    const skill = makeSkill('used-skill', { usageCount: 5 })
    expect(shouldBeDormant(skill)).toBe(false)
  })

  it('returns false for recently updated unused skills', () => {
    const now = Date.now()
    const skill = makeSkill('recent-skill', {
      usageCount: 0,
      updatedAt: now - 10 * 24 * 60 * 60 * 1000,
    })
    expect(shouldBeDormant(skill, now)).toBe(false)
  })

  it('returns true for old unused skills', () => {
    const now = Date.now()
    const skill = makeSkill('old-skill', {
      usageCount: 0,
      updatedAt: now - (DORMANCY_DAYS + 1) * 24 * 60 * 60 * 1000,
    })
    expect(shouldBeDormant(skill, now)).toBe(true)
  })
})

describe('processDormancy', () => {
  it('makes old unused skills dormant', async () => {
    const { store, close } = makeStore()
    try {
      const now = Date.now()

      await store.putSkill(makeSkill('active-skill', { usageCount: 5 }))
      await store.putSkill(makeSkill('old-unused', {
        usageCount: 0,
        updatedAt: now - 30 * 24 * 60 * 60 * 1000,
      }))
      await store.putSkill(makeSkill('recent-unused', {
        usageCount: 0,
        updatedAt: now - 5 * 24 * 60 * 60 * 1000,
      }))

      const madeDormant = await processDormancy(scope, store, now)

      expect(madeDormant).toContain('old-unused')
      expect(madeDormant).not.toContain('active-skill')
      expect(madeDormant).not.toContain('recent-unused')

      const dormantSkill = await store.getSkill(scope, 'old-unused')
      expect(dormantSkill?.dormant).toBe(true)
    } finally {
      close()
    }
  })

  it('wakes dormant skills on use', async () => {
    const { store, close } = makeStore()
    try {
      await store.putSkill(makeSkill('dormant-skill', { dormant: true }))

      await store.incrementUsage(scope, 'dormant-skill')

      const skill = await store.getSkill(scope, 'dormant-skill')
      expect(skill?.dormant).toBe(false)
      expect(skill?.usageCount).toBe(1)
    } finally {
      close()
    }
  })

  it('excludes dormant skills from default list', async () => {
    const { store, close } = makeStore()
    try {
      await store.putSkill(makeSkill('active-skill'))
      await store.putSkill(makeSkill('dormant-skill', { dormant: true }))

      const defaultList = await store.listSkills({ scopes: [scope] })
      expect(defaultList.map(s => s.name)).toContain('active-skill')
      expect(defaultList.map(s => s.name)).not.toContain('dormant-skill')

      const allList = await store.listSkills({ scopes: [scope], includeDormant: true })
      expect(allList.map(s => s.name)).toContain('active-skill')
      expect(allList.map(s => s.name)).toContain('dormant-skill')
    } finally {
      close()
    }
  })
})
