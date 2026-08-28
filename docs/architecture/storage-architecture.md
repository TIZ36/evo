# Storage Architecture

This document describes how evo stores and manages memory data.

## Layer Overview

```
evo core
├── MemoryItem / MemoryScope    Domain types
├── MemoryStore                 Storage interface
├── Reflector                   Turn → memory extraction
├── Consolidator                Memory merging and cleanup
├── MemoryMaterializer          Output to files/context
└── MemoryEventSink             Audit logging

Default Implementation
└── SQLiteMemoryStore           Node.js built-in sqlite

Host Adapters
├── CordisPlugin                DeepSeek Harness
├── ClaudeCodeHook              Claude Code CLI
└── CodexHook                   Codex CLI
```

## Data Model

Memory items contain at minimum:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Stable unique identifier |
| `scope` | object | Where this memory applies |
| `kind` | string | Type: fact, constraint, procedure, skill |
| `title` | string | Short identifier |
| `content` | string | The actual knowledge |
| `tags` | string[] | Categorization |
| `createdAt` | timestamp | When first created |
| `updatedAt` | timestamp | Last modification |
| `uses` | number | Recall count |
| `source` | object | Origin session and turn |

Skills can be a memory kind or a future extension, but Paper-specific fields like `maturity` are not part of the core protocol.

## Storage Interface

```ts
interface MemoryStore {
  list(query: MemoryQuery): Promise<MemoryItem[]>
  get(id: string): Promise<MemoryItem | null>
  put(item: MemoryItem): Promise<void>
  delete(id: string): Promise<void>
  replace(scope: MemoryScope, items: MemoryItem[]): Promise<void>
}
```

The first version uses SQLite, but the path is injected via configuration. Core code never reads from hardcoded paths.

## Default Path Strategy

Default paths follow host platform conventions using `evo` as the application subdirectory:

| Platform | Default Directory |
| --- | --- |
| macOS | `~/Library/Application Support/evo/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/evo/` |
| Windows | `%APPDATA%\evo\` |

Configuration precedence:

1. Explicit runtime configuration (`databasePath`)
2. Configured directory (`dataDir`)
3. Environment variable (`EVO_DATA_DIR`)
4. Legacy environment variable (`EVO_MEMORY_DATA_DIR`)
5. Platform default

Path resolution belongs to the infrastructure layer, not scattered in core business code.

## Materialization Strategy

Materialization is an optional capability:

- DeepSeek adapter consumes structured injection fragments by default
- Markdown/JSON materializers are enabled only when human-readable output or host file protocols are needed
- Materialized files are never the cross-host source of truth

## Migration Support

When upgrading from `evo-memory`:

- If the new `evo/` directory has no `memory.db` but the old `evo-memory/` directory does, evo continues using the old file
- Move it to the new directory whenever convenient
- Legacy environment variables are still read after their `EVO_*` counterparts

## SQLite Implementation

The default `SQLiteMemoryStore`:

- Uses Node.js built-in `node:sqlite` (requires Node 22.19+)
- No native addons needed
- Single file storage
- Transactional writes

Database schema supports the full memory item model plus indices for efficient scope and kind queries.
