# evo-memory

`evo-memory` is a provider-neutral evolving memory service with a Cordis plugin and a native DeepSeek Harness adapter. It recalls durable memory before model steps and reflects completed turns into structured memory afterward.

This first release is intentionally independent from Paper, Claude, and Codex.

## Requirements

- Node.js 22.19 or newer
- DeepSeek Harness `0.1.x`
- A configured Harness LLM provider and model for reflection and consolidation

The default store uses Node's built-in `node:sqlite`; no native addon compilation is required.

## Install

Until the package is published, install it from a local checkout:

```bash
pnpm add /absolute/path/to/evo-memory
```

After publication:

```bash
pnpm add evo-memory
```

## DeepSeek Harness configuration

For an npx-managed Harness profile, run the installer from this checkout:

```bash
./install_evo_dsps.sh
```

It builds the package, installs a local link through the official `dsh plugin`
command, and activates `evo-memory` as a DSH bundle. The default profile is
`web`; override it with `DSH_PROFILE=tui` or another profile name. The script
does not edit the profile's user `cordis.patch.yml`.

The bundle uses `deepseek-official` and `deepseek-v4-flash` by default. Override
them when launching Harness with `EVO_MEMORY_PROVIDER` and `EVO_MEMORY_MODEL`.

Manual configuration is also supported. Add both plugins after the Harness LLM
and system-prompt services:

```yaml
- id: evo-memory
  name: evo-memory/cordis
  config: {}

- id: evo-memory-deepseek
  name: evo-memory/deepseek
  config:
    provider: deepseek-official
    model: deepseek-chat
    recallLimit: 40
    maxContextChars: 6000
    reflect: true
```

See [`examples/cordis.yml`](examples/cordis.yml) for a copyable fragment.

The adapter uses official Harness extension points:

- `system-prompt/assemble` recalls global, project, and session memories into dynamic context.
- `session/event` observes successful `turn/end` events and reflects their user, assistant, and tool activity.
- `ctx.llm.stream()` runs reflection and consolidation through the configured Harness model route.

Interrupted, aborted, rejected, and failed turns are not reflected.

## Default storage

With no storage configuration, the SQLite database is created at:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/evo-memory/memory.db` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/evo-memory/memory.db` |
| Windows | `%APPDATA%\evo-memory\memory.db` |

Override the directory with `EVO_MEMORY_DATA_DIR` or plugin config:

```yaml
config:
  dataDir: /srv/agent-memory
```

Override the complete database path when needed:

```yaml
config:
  databasePath: /srv/agent-memory/team-a.db
```

Precedence is `databasePath`, `dataDir`, `EVO_MEMORY_DATA_DIR`, then the platform default.

## Cordis service API

The Cordis plugin registers `ctx.evoMemory`:

```ts
await ctx.evoMemory.remember({
  scope: { type: 'project', id: '/workspace/app' },
  kind: 'constraint',
  title: 'Verification',
  content: 'Run the full check command before reporting completion.',
})

const items = await ctx.evoMemory.recall({
  scopes: [{ type: 'project', id: '/workspace/app' }],
  text: 'verification',
})

await ctx.evoMemory.consolidate({ type: 'project', id: '/workspace/app' })
```

The core exports `MemoryStore`, `ModelRunner`, `MemoryMaterializer`, and `MemoryEventSink`. SQLite and DeepSeek Harness are implementations behind those interfaces, not dependencies of the memory domain model.

## Memory scopes

The core supports `global`, `user`, `project`, `session`, and `conversation` scopes. The DeepSeek adapter currently writes completed-turn reflection to the project scope when `session.header.cwd` exists, otherwise to global scope. Recall combines global, project, and current session scopes.

## Privacy and safety

Reflection prompts explicitly reject secrets, credentials, raw logs, guesses, and transient task state. The SQLite database remains local by default. Model-based reflection still sends the completed turn to the configured Harness model provider; disable it with `reflect: false` when that is not acceptable.

Materialized Markdown is deliberately not a source of truth in v1. Structured storage remains authoritative.

## Current limitations

- Recall is deterministic SQLite filtering and ranking, without embeddings.
- Reflection runs once per successful turn; queueing and sleep consolidation are not yet included.
- Automatic consolidation scheduling is not included; call `consolidate()` explicitly.
- There are no Paper, Claude, Codex, MCP, remote-store, or synchronization adapters yet.
- `node:sqlite` is marked experimental by current Node releases even though it ships with Node 22+.

## Development

```bash
pnpm install
pnpm check
pnpm pack --dry-run
```

The design authority is [`docs/reference/evo-reference.md`](docs/reference/evo-reference.md). Open-source boundaries and storage decisions are recorded in [`docs/design-principles.md`](docs/design-principles.md) and [`docs/storage-architecture.md`](docs/storage-architecture.md).
