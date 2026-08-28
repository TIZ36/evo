import type { ModelRunner, SkillStore } from './contracts.js'
import type { MemoryScope, SkillBody, SkillItem, SkillLesson } from './types.js'
import { parseModelJson } from './json-model.js'
import { z } from 'zod'

// ── L1 Form Check ─────────────────────────────────────────────────────────────

export type FormCheckResult = {
  valid: boolean
  issues: string[]
}

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * L1 form check for skills.
 *
 * Validates:
 * - Kebab-case name
 * - Purpose present and concise
 * - Trigger with don't-use lines
 * - Anchored steps (numbered or bulleted)
 * - Falsifiable check
 */
export function checkSkillForm(skill: SkillItem): FormCheckResult {
  const issues: string[] = []

  if (!KEBAB_CASE_REGEX.test(skill.name)) {
    issues.push('name must be kebab-case')
  }

  if (!skill.body.purpose || skill.body.purpose.length < 10) {
    issues.push('purpose too short')
  }
  if (skill.body.purpose.length > 500) {
    issues.push('purpose too long (max 500 chars)')
  }

  if (!skill.body.trigger || skill.body.trigger.length < 10) {
    issues.push('trigger too short')
  }

  if (!skill.body.steps || skill.body.steps.length < 20) {
    issues.push('steps too short')
  }
  const stepLines = skill.body.steps.split('\n').filter(l => /^\s*[\d\-\*]/.test(l))
  if (stepLines.length < 2) {
    issues.push('steps should have at least 2 numbered/bulleted items')
  }

  if (!skill.body.check || skill.body.check.length < 10) {
    issues.push('check (verification) too short')
  }

  if (skill.body.reflex && skill.body.reflex.length > 500) {
    issues.push('reflex too long (max 500 chars)')
  }

  return { valid: issues.length === 0, issues }
}

// ── Polish Guards ─────────────────────────────────────────────────────────────

export type PolishGuardResult = {
  allowed: boolean
  reason?: string
}

/**
 * Guards against runaway polish.
 *
 * Rejects:
 * - Step count growth > 50%
 * - Invented absolute paths
 * - Runaway reflex length
 */
export function polishGuard(original: SkillBody, polished: SkillBody): PolishGuardResult {
  const originalStepCount = original.steps.split('\n').filter(l => /^\s*[\d\-\*]/.test(l)).length
  const polishedStepCount = polished.steps.split('\n').filter(l => /^\s*[\d\-\*]/.test(l)).length

  if (originalStepCount > 0 && polishedStepCount > originalStepCount * 1.5) {
    return { allowed: false, reason: `step count grew from ${originalStepCount} to ${polishedStepCount}` }
  }

  const absolutePathRegex = /(?:\/(?:Users|home|opt|var|etc)\/|[A-Z]:\\)/
  if (!absolutePathRegex.test(original.steps) && absolutePathRegex.test(polished.steps)) {
    return { allowed: false, reason: 'polish introduced absolute paths' }
  }

  if (polished.reflex && polished.reflex.length > 500) {
    return { allowed: false, reason: 'reflex too long after polish' }
  }

  return { allowed: true }
}

// ── Polish Prompt ─────────────────────────────────────────────────────────────

const polishResponseSchema = z.object({
  body: z.object({
    purpose: z.string().min(1).max(500),
    trigger: z.string().min(1).max(1000),
    steps: z.string().min(1).max(4000),
    check: z.string().min(1).max(500),
    reflex: z.string().max(500).optional(),
  }),
})

export function polishPrompt(skill: SkillItem, lessons: SkillLesson[]): string {
  const lessonText = lessons.map(l => `- ${l.text}`).join('\n')
  return `Polish this skill based on accumulated lessons. Fold lessons into the body where appropriate.

SKILL: ${skill.name}

CURRENT BODY:
Purpose: ${skill.body.purpose}

Trigger: ${skill.body.trigger}

Steps:
${skill.body.steps}

Check: ${skill.body.check}

${skill.body.reflex ? `Reflex: ${skill.body.reflex}` : ''}

LESSONS TO FOLD:
${lessonText}

CONSTRAINTS:
- Do NOT grow step count by more than 50%
- Do NOT invent absolute file paths (use ~/ or relative)
- Keep reflex under 500 chars
- Preserve the core procedure structure

Return JSON only: {"body":{"purpose":"...","trigger":"...","steps":"...","check":"...","reflex":"..."}}`
}

export type PolishResult = {
  polished: SkillBody | null
  guard?: PolishGuardResult
  error?: string
}

/**
 * Polish a skill by folding accumulated lessons into its body.
 */
export async function polishSkill(
  skill: SkillItem,
  lessons: SkillLesson[],
  model: ModelRunner,
  signal?: AbortSignal,
): Promise<PolishResult> {
  if (!lessons.length) {
    return { polished: null, error: 'no lessons to fold' }
  }

  const formCheck = checkSkillForm(skill)
  if (!formCheck.valid) {
    return { polished: null, error: `form check failed: ${formCheck.issues.join(', ')}` }
  }

  try {
    const response = await model.complete({
      purpose: 'consolidate',
      prompt: polishPrompt(skill, lessons),
      ...(signal ? { signal } : {}),
    })
    const parsed = polishResponseSchema.parse(parseModelJson(response))
    const guard = polishGuard(skill.body, parsed.body)

    if (!guard.allowed) {
      return { polished: null, guard }
    }

    return { polished: parsed.body }
  } catch (error) {
    return { polished: null, error: String(error) }
  }
}

// ── Dormancy ──────────────────────────────────────────────────────────────────

export const DORMANCY_DAYS = 21

/**
 * Check if a skill should become dormant.
 *
 * A skill becomes dormant when:
 * - usageCount = 0
 * - Untouched for >= DORMANCY_DAYS
 */
export function shouldBeDormant(skill: SkillItem, now = Date.now()): boolean {
  if (skill.usageCount > 0) return false
  const daysSinceUpdate = (now - skill.updatedAt) / (1000 * 60 * 60 * 24)
  return daysSinceUpdate >= DORMANCY_DAYS
}

/**
 * Process dormancy for all skills in a scope.
 * Returns the names of skills that were made dormant.
 */
export async function processDormancy(
  scope: MemoryScope,
  store: SkillStore,
  now = Date.now(),
): Promise<string[]> {
  const skills = await store.listSkills({ scopes: [scope], includeDormant: true, limit: 1000 })
  const madeDormant: string[] = []

  for (const skill of skills) {
    if (!skill.dormant && shouldBeDormant(skill, now)) {
      await store.setDormant(scope, skill.name, true)
      madeDormant.push(skill.name)
    }
  }

  return madeDormant
}

/**
 * Find skills that need polishing.
 *
 * A skill needs polishing when:
 * - Has >= 3 unfolded lessons
 * - Or form check fails
 */
export async function findSkillsToPolish(
  scope: MemoryScope,
  store: SkillStore,
  minLessons = 3,
): Promise<SkillItem[]> {
  const skills = await store.listSkills({ scopes: [scope], limit: 100 })
  const toPolish: SkillItem[] = []

  for (const skill of skills) {
    const unfolded = await store.getUnfoldedLessons(scope, skill.name)
    const formCheck = checkSkillForm(skill)

    if (unfolded.length >= minLessons || !formCheck.valid) {
      toPolish.push(skill)
    }
  }

  return toPolish
}

/**
 * Process polish for skills that need it.
 * Returns results for each skill processed.
 */
export async function processPolish(
  scope: MemoryScope,
  store: SkillStore,
  model: ModelRunner,
  maxPerBatch = 2,
  signal?: AbortSignal,
): Promise<Array<{ skill: string; result: PolishResult }>> {
  const toPolish = await findSkillsToPolish(scope, store)
  const results: Array<{ skill: string; result: PolishResult }> = []

  for (const skill of toPolish.slice(0, maxPerBatch)) {
    const lessons = await store.getUnfoldedLessons(scope, skill.name)
    const result = await polishSkill(skill, lessons, model, signal)

    if (result.polished) {
      const updated: SkillItem = {
        ...skill,
        body: result.polished,
        updatedAt: Date.now(),
      }
      await store.putSkill(updated)
      await store.markLessonsFolded(scope, skill.name)
    }

    results.push({ skill: skill.name, result })
  }

  return results
}
