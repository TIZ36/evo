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
