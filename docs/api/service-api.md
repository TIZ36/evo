# Service API

The Cordis plugin registers `ctx.evo` as a service for programmatic access within DeepSeek Harness.

## Core Methods

### remember

Stores a memory item.

```ts
await ctx.evo.remember({
  scope: { type: 'project', id: '/workspace/app' },
  kind: 'constraint',
  title: 'Verification',
  content: 'Run the full check command before reporting completion.',
  tags: ['workflow', 'ci']
})
```

### recall

Retrieves memories matching criteria.

```ts
const items = await ctx.evo.recall({
  scopes: [
    { type: 'global' },
    { type: 'project', id: '/workspace/app' }
  ],
  text: 'verification',
  kinds: ['constraint', 'procedure'],
  limit: 20
})
```

### consolidate

Merges and cleans up memories in a scope.

```ts
const result = await ctx.evo.consolidate({
  type: 'project',
  id: '/workspace/app'
})

console.log(`Consolidated: ${result.before} → ${result.after} items`)
```

### importWorkspace

Imports workspace files into project memory.

```ts
await ctx.evo.importWorkspace('/workspace/app', { force: true })
```

## Interfaces

The core exports these interfaces for custom implementations:

### MemoryStore

```ts
interface MemoryStore {
  list(query: MemoryQuery): Promise<MemoryItem[]>
  get(id: string): Promise<MemoryItem | null>
  put(item: MemoryItem): Promise<void>
  delete(id: string): Promise<void>
  replace(scope: MemoryScope, items: MemoryItem[]): Promise<void>
}
```

### ModelRunner

```ts
interface ModelRunner {
  stream(prompt: string, options?: StreamOptions): AsyncIterable<string>
}
```

### MemoryMaterializer

```ts
interface MemoryMaterializer {
  materialize(items: MemoryItem[], target: string): Promise<void>
}
```

### MemoryEventSink

```ts
interface MemoryEventSink {
  emit(event: MemoryEvent): void
}
```

## Type Definitions

### MemoryScope

```ts
type MemoryScopeType = 'global' | 'user' | 'project' | 'session' | 'conversation'

interface MemoryScope {
  type: MemoryScopeType
  id?: string
}
```

### MemoryItem

```ts
interface MemoryItem {
  id: string
  scope: MemoryScope
  kind: 'fact' | 'constraint' | 'procedure' | 'skill'
  title: string
  content: string
  tags: string[]
  source: MemorySource
  createdAt: Date
  updatedAt: Date
  uses: number
}
```

### MemoryQuery

```ts
interface MemoryQuery {
  scopes?: MemoryScope[]
  kinds?: string[]
  text?: string
  tags?: string[]
  limit?: number
}
```

## Provider-Neutral Design

The domain model depends only on these interfaces. SQLite and DeepSeek Harness are implementations, not dependencies:

- `SQLiteMemoryStore` implements `MemoryStore`
- Harness adapter implements `ModelRunner` via `ctx.llm.stream()`

This allows replacing storage or model backend without changing the core memory logic.
