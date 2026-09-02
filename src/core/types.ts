import { z } from 'zod'

export const scopeTypeSchema = z.enum(['global', 'user', 'project', 'session', 'conversation'])
export type ScopeType = z.infer<typeof scopeTypeSchema>

export type MemoryScope = {
  type: ScopeType
  id?: string | undefined
  parent?: MemoryScope | undefined
}

export const memoryScopeSchema: z.ZodType<MemoryScope> = z.lazy(() => z.object({
  type: scopeTypeSchema,
  id: z.string().min(1).optional(),
  parent: memoryScopeSchema.optional(),
}).superRefine((scope, context) => {
  if (scope.type !== 'global' && !scope.id) {
    context.addIssue({ code: 'custom', message: `${scope.type} scope requires an id` })
  }
}))

export const memoryKindSchema = z.enum(['fact', 'preference', 'constraint', 'procedure', 'skill'])
export type MemoryKind = z.infer<typeof memoryKindSchema>

// ── Skill types ───────────────────────────────────────────────────────────────

/** Kebab-case skill name regex (e.g. "git-commit-workflow"). */
export const skillNameSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'skill name must be kebab-case')

/** The five canonical sections of a SKILL.md body. */
export const skillBodySchema = z.object({
  purpose: z.string().min(1).max(500),
  trigger: z.string().min(1).max(1000),
  steps: z.string().min(1).max(4000),
  check: z.string().min(1).max(500),
  reflex: z.string().max(500).optional(),
})
export type SkillBody = z.infer<typeof skillBodySchema>

export const skillSourceSchema = z.object({
  runtime: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turn: z.number().int().nonnegative().optional(),
  /** Absolute source path, set for disk-hydrated skills. */
  path: z.string().min(1).optional(),
})
export type SkillSource = z.infer<typeof skillSourceSchema>

/** Promotion threshold: skills with uses >= this are considered mature/established. */
export const SKILL_PROMOTION_THRESHOLD = 3

export const skillItemSchema = z.object({
  name: skillNameSchema,
  scope: memoryScopeSchema,
  body: skillBodySchema,
  usageCount: z.number().int().nonnegative().default(0),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  source: skillSourceSchema.optional(),
  dormant: z.boolean().default(false),
  /** True when uses >= SKILL_PROMOTION_THRESHOLD. Promoted skills are mature/established. */
  promoted: z.boolean().default(false),
})
export type SkillItem = z.infer<typeof skillItemSchema>

export const skillLessonSchema = z.object({
  text: z.string().min(1).max(500),
  sessionId: z.string().min(1).optional(),
  turn: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
})
export type SkillLesson = z.infer<typeof skillLessonSchema>

/** A skill candidate emitted by the reflector. */
export type SkillCandidate = {
  name: string
  body: SkillBody
}

export type SkillQuery = {
  scopes?: MemoryScope[]
  text?: string
  limit?: number
  includeDormant?: boolean
}

export type SkillDelta = {
  created: SkillItem | null
  updated: SkillItem | null
}

// ── Consolidation types ───────────────────────────────────────────────────────

/** Raw batch stored in replay buffer for slow-path consolidation. */
export type ReplayEntry = {
  id: number
  scope: MemoryScope
  batch: { memories: Array<{ title: string; content: string; kind: MemoryKind }> }
  createdAt: number
  consumed: boolean
}

/** Consolidation state for a scope. */
export type ConsolidationState = {
  scopeKey: string
  lastConsolidateAt: number
  lastDigest: string | null
  converged: boolean
  convergenceMultiplier: number
}

/** Result of a sleep/auto-consolidate check. */
export type SleepCheckResult = {
  shouldConsolidate: boolean
  reason: 'backlog' | 'replay' | 'schedule' | 'none'
  backlogSize: number
  replaySize: number
  hoursSinceLastConsolidate: number
}

// ── Retention types ───────────────────────────────────────────────────────────

/** Store capacity configuration. */
export type RetentionConfig = {
  /** Max memories per scope before eviction. */
  maxMemories: number
  /** Days before a memory with 0 uses becomes eviction candidate. */
  newbornGraceDays: number
  /** Hours between auto-consolidate runs (base, before convergence multiplier). */
  consolidateIntervalHours: number
  /** Min hours between consolidates even when converged. */
  convergedMinIntervalHours: number
}

export const memorySourceSchema = z.object({
  runtime: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turn: z.number().int().nonnegative().optional(),
  /** Absolute source path, set for workspace-imported memories. */
  path: z.string().min(1).optional(),
})
export type MemorySource = z.infer<typeof memorySourceSchema>

export const memoryItemSchema = z.object({
  id: z.string().min(1),
  scope: memoryScopeSchema,
  kind: memoryKindSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).optional(),
  usageCount: z.number().int().nonnegative().default(0),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  source: memorySourceSchema.optional(),
})
export type MemoryItem = z.infer<typeof memoryItemSchema>

export type MemoryQuery = {
  scopes?: MemoryScope[]
  kinds?: MemoryKind[]
  text?: string
  tags?: string[]
  limit?: number
}

export type Turn = {
  sessionId: string
  turn: number
  scope: MemoryScope
  user: string
  assistant: string
  tools?: string[]
}

export type MemoryCandidate = Pick<MemoryItem, 'kind' | 'title' | 'content'> & {
  scope?: MemoryScope | undefined
  tags?: string[] | undefined
  confidence?: number | undefined
}

export type MemoryDelta = {
  created: MemoryItem[]
  updated: MemoryItem[]
  deleted: string[]
}

export type ConsolidationResult = {
  before: number
  after: number
  items: MemoryItem[]
}

export function scopeKey(scope: MemoryScope): string {
  const own = scope.type === 'global' ? 'global' : `${scope.type}:${encodeURIComponent(scope.id ?? '')}`
  return scope.parent ? `${scopeKey(scope.parent)}/${own}` : own
}
