import type { ConsolidationResult, MemoryDelta, MemoryItem, MemoryQuery, MemoryScope, Turn } from './types.js'

export interface MemoryStore {
  get(id: string): Promise<MemoryItem | null>
  list(query?: MemoryQuery): Promise<MemoryItem[]>
  put(item: MemoryItem): Promise<void>
  delete(id: string): Promise<void>
  replace(scope: MemoryScope, items: MemoryItem[]): Promise<void>
  close?(): void | Promise<void>
}

export interface ModelRunner {
  complete(request: { purpose: 'reflect' | 'consolidate'; prompt: string; signal?: AbortSignal }): Promise<string>
}

export interface MemoryMaterializer<T = unknown> {
  materialize(items: MemoryItem[], target: T): Promise<unknown>
}

export type MemoryEvent =
  | { type: 'memory.created' | 'memory.updated'; item: MemoryItem }
  | { type: 'memory.deleted'; id: string }
  | { type: 'memory.consolidated'; scope: MemoryScope; result: ConsolidationResult }
  | { type: 'memory.reflected'; turn: Turn; delta: MemoryDelta }

/** One persisted activity-log row, newest first. */
export type MemoryEventRecord = {
  type: string
  scope?: MemoryScope | undefined
  payload: MemoryEvent
  createdAt: number
}

export interface MemoryEventSink {
  emit(event: MemoryEvent): void | Promise<void>
}

export const noopEventSink: MemoryEventSink = { emit() {} }
