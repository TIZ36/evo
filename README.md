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

# Optional: carries the Settings → Memory web panel (bare package name so the
# client-modules scan discovers the dsh.client bundle).
- id: evo-memory-web
  name: evo-memory
  config: {}
```

See [`examples/cordis.yml`](examples/cordis.yml) for a copyable fragment.

The adapter uses official Harness extension points:

- `system-prompt/assemble` recalls global, project, and session memories into dynamic context.
- `session/event` observes successful `turn/end` events and reflects their user, assistant, and tool activity.
- `ctx.llm.stream()` runs reflection and consolidation through the configured Harness model route.

Interrupted, aborted, rejected, and failed turns are not reflected.

## Workspace import (`.claude` / `.codex` / `.copilot` / `.agent` / `.paper`)

When a session opens in a project working directory (`session.header.cwd`), the
adapter imports the project's existing agent memory and skill files into the
project scope on the first prompt assembly. The imported knowledge is then
recalled like any other memory — no configuration required.

| File / directory (relative to `cwd`) | Memory kind |
| --- | --- |
| `CLAUDE.md`, `.claude/CLAUDE.md` | fact |
| `AGENTS.md`, `agents.md`, `.agent/AGENTS.md` | constraint |
| `.paper/AGENT_MEMORY.md`, `.paper/**/*.md` | fact |
| `.claude/commands/**/*.md`, `.claude/agents/**/*.md` | procedure |
| `.codex/**/*.md`, `.copilot/instructions/**/*.md`, `.copilot/prompts/**/*.md`, `.agent/**/*.md` | constraint |
| `.claude/skills/**/SKILL.md`, `.codex/skills/**/SKILL.md`, `.copilot/skills/**/SKILL.md`, `.agent/skills/**/SKILL.md`, `.paper/skills/**/SKILL.md`, `.paper/agents/skills/**/SKILL.md` | skill |

Each file becomes one memory item titled with its path relative to the workspace
root, tagged `workspace-import` plus `tool:<tool>`, and sourced with
`runtime: 'workspace-import'` and the absolute file path. YAML frontmatter is
stripped; `*.memory.md` skill-experience files and empty documents are skipped.

Import is idempotent: items are upserted by `(project scope, title)`, changed
files update in place, and removed files are never deleted. A project is
imported once; re-scan with `force` through the service API:

```ts
await ctx.evoMemory.importWorkspace('/workspace/app', { force: true })
```

Disable the automatic import with `workspaceImport: false` in the
`evo-memory-deepseek` config.

## Native Web panel (Settings → Memory)

The package ships a web client half (`dsh.client` + `exports["./client"]`) that
adds a **Memory** page to the Harness GUI Settings section. The panel shows the
memory list (kind tabs + search), the recent reflect/consolidate activity log,
and actions to consolidate a scope or force a workspace re-import. It is served
by the DSH client-modules mechanism at `/plugins/evo-memory/client.js` and needs
no separate build step.

In a live conversation the composer tool row also gets an **evo memory** chip
(left end) that keeps the evo mark visible and pulses while evo-memory is
reflecting/consolidating (it polls `/evo-memory/status`). A small `turninfo`
hint below the input explains that root and cwd memory are active; clicking the
chip or hint opens a collapsible card in the conversation's top-right corner.

The client half is carried by a no-op Loader row named by the bare package
(`evo-memory-web` in `cordis.patch.yml`): the client-modules scan discovers
`dsh.client` packages only through bare package names, so a subpath row like
`evo-memory/cordis` cannot carry a web client. Restart Harness after upgrading
for the new boot graph to include the panel.

## HTTP API (`/evo-memory/*`)

The cordis plugin registers a raw route prefix on the DSH web server when the
`webServer` service is present (the `/api` prefix belongs to the DSH web
transport, so a plugin bridge uses its own path). These endpoints are the
reserved integration surface for external frontends:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/evo-memory/status` | `{ ok, databasePath }` |
| GET | `/evo-memory/memories` | List; query `scopeType`, `scopeId`, `kind` (comma list), `text`, `tags`, `limit` |
| GET | `/evo-memory/memories/:id` | One memory or 404 |
| GET | `/evo-memory/events` | Recent activity log, newest first; query `limit` |
| POST | `/evo-memory/consolidate` | Body `{ scope: { type, id? } }` → consolidation result |
| POST | `/evo-memory/import-workspace` | Body `{ cwd, force? }` → workspace import result |

The web server binds loopback by default; every response is JSON. The same data
backs the native Settings panel.

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

## Project rule

This is a personal open-source project. Company identity and sensitive
information — company names, brands, domains, mailboxes, employee names,
internal codenames, intranet addresses, or machine absolute paths — must never
appear anywhere in the repository, including built artifacts. Team attribution
is "Paper team" only. The rule is enforced by `scripts/iron-rule.mjs`: the
source tree is checked on `pnpm test`, and the full tree including `dist/` is
checked by `pnpm check`.

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
