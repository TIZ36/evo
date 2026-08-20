<div align="center">

# evo

**Evolving memory for agents — recall before the model thinks, reflect after it answers.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-5fa04e.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](#limitations)

</div>

`evo` is a provider-neutral memory service with a Cordis plugin and a native DeepSeek Harness
adapter. It recalls durable memory into the system prompt before a
model step, and reflects completed turns into structured memory afterwards — so an agent keeps what
it learned across sessions without you writing it down.

> **Renamed:** this project was published as `evo-memory` until `0.2.x`. The old data directory, the
> old `EVO_MEMORY_*` environment variables, and the old `/evo-memory/*` HTTP prefix all still work —
> see [Migrating from `evo-memory`](#migrating-from-evo-memory).

## Contents

- [Features](#features) · [Requirements](#requirements) · [Install](#install) · [Quick start](#quick-start)
- [How it works](#how-it-works) · [Workspace import](#workspace-import) · [Settings panel](#settings--memory-panel)
- [Claude Code hook](#claude-code-hook) · [Codex plugin](#codex-plugin) · [HTTP API](#http-api)
- [Configuration](#configuration) · [Service API](#service-api) · [Scopes](#memory-scopes)
- [Privacy](#privacy-and-safety) · [Limitations](#limitations) · [Development](#development) · [License](#license)

## Features

- **Recall + reflect loop.** Memory is assembled into the system prompt on every turn, and each
  successful turn is distilled back into structured memory items.
- **Structured, not a scratchpad.** Every item has a scope, a kind (`fact`, `constraint`,
  `procedure`, `skill`, …), tags, and a source pointing at the session and turn it came from.
- **Local by default.** Storage is a single SQLite file via Node's built-in `node:sqlite` — no
  native addon, no service to run, nothing leaves the machine except the reflection model call.
- **Workspace import.** Existing `CLAUDE.md`, `AGENTS.md`, `.codex/`, `.copilot/`, `.agent/`, and
  `.paper/` files in a project are imported as project-scoped memory on first use.
- **Provider-neutral core.** The domain model depends on interfaces (`MemoryStore`, `ModelRunner`,
  `MemoryMaterializer`, `MemoryEventSink`); SQLite and DeepSeek Harness are implementations.
- **Native web panel.** A Settings → Memory page plus a composer status chip, shipped as a
  plain-JS client half with no extra build step.
- **Claude Code and Codex plugin.** One hook bridge, shipped as a plugin to both CLIs: it
  recalls memory into a session and distils finished turns back into it, using whichever CLI
  it runs under — and that CLI's own credentials.

## Requirements

- Node.js 22.19 or newer
- DeepSeek Harness `0.1.x` (for the adapter and the web panel)
- A configured Harness LLM provider and model for reflection and consolidation

The Cordis plugin and the core work without Harness; the Harness pieces are optional peers.

## Install

```bash
pnpm add evo
```

From a local checkout, before publication:

```bash
pnpm add /absolute/path/to/evo
```

## Quick start

### DeepSeek Harness, via the installer

For an npx-managed Harness profile, run the installer from a checkout:

```bash
./install_evo_dsps.sh
```

It builds the package, installs a local link through the official `dsh plugin` command, and
activates `evo` as a DSH bundle. The default profile is `web`; override it with `DSH_PROFILE=tui`
or another profile name. The script never edits the profile's user `cordis.patch.yml`.

The bundle uses `deepseek-official` and `deepseek-v4-flash` by default; override them at launch
with `EVO_PROVIDER` and `EVO_MODEL`.

### DeepSeek Harness, by hand

Add the plugins after the Harness LLM and system-prompt services:

```yaml
- id: evo
  name: evo/cordis
  config: {}

- id: evo-deepseek
  name: evo/deepseek
  config:
    provider: deepseek-official
    model: deepseek-chat
    recallLimit: 40
    maxContextChars: 6000
    reflect: true

# Optional: carries the Settings → Memory web panel. The bare package name is
# required — the client-modules scan only discovers dsh.client bundles there.
- id: evo-web
  name: evo
  config: {}
```

[`examples/cordis.yml`](examples/cordis.yml) has a copyable fragment.

## How it works

The adapter uses official Harness extension points only:

| Extension point | Role |
| --- | --- |
| `system-prompt/assemble` | Recalls global, project, and session memory into dynamic context |
| `session/event` | Observes successful `turn/end` events and reflects user, assistant, and tool activity |
| `ctx.llm.stream()` | Runs reflection and consolidation through the configured Harness model route |

Interrupted, aborted, rejected, and failed turns are never reflected.

## Workspace import

When a session opens in a project working directory (`session.header.cwd`), the adapter imports the
project's existing agent memory and skill files into the project scope on the first prompt assembly.
The imported knowledge is then recalled like any other memory — no configuration required.

| File / directory (relative to `cwd`) | Memory kind |
| --- | --- |
| `CLAUDE.md`, `.claude/CLAUDE.md` | fact |
| `AGENTS.md`, `agents.md`, `.agent/AGENTS.md` | constraint |
| `.paper/AGENT_MEMORY.md`, `.paper/**/*.md` | fact |
| `.claude/commands/**/*.md`, `.claude/agents/**/*.md` | procedure |
| `.codex/**/*.md`, `.copilot/instructions/**/*.md`, `.copilot/prompts/**/*.md`, `.agent/**/*.md` | constraint |
| `.claude/skills/**/SKILL.md`, `.codex/skills/**/SKILL.md`, `.copilot/skills/**/SKILL.md`, `.agent/skills/**/SKILL.md`, `.paper/skills/**/SKILL.md`, `.paper/agents/skills/**/SKILL.md` | skill |

Each file becomes one memory item titled with its path relative to the workspace root, tagged
`workspace-import` plus `tool:<tool>`, and sourced with `runtime: 'workspace-import'` and the
absolute file path. YAML frontmatter is stripped; `*.memory.md` skill-experience files and empty
documents are skipped.

Import is idempotent: items are upserted by `(project scope, title)`, changed files update in place,
and removed files are never deleted. A project is imported once; re-scan with `force`:

```ts
await ctx.evo.importWorkspace('/workspace/app', { force: true })
```

Disable the automatic import with `workspaceImport: false` in the `evo-deepseek` config.

## Settings → Memory panel

The package ships a web client half (`dsh.client` + `exports["./client"]`) that adds a **Memory**
page to the Harness GUI Settings section: the memory list (kind tabs + search), the recent
reflect/consolidate activity log, and actions to consolidate a scope or force a workspace re-import.
It is served by the DSH client-modules mechanism at `/plugins/evo/client.js` and needs no separate
build step.

In a live conversation the composer tool row also gets an **evo** chip that keeps the mark visible
and pulses while evo is reflecting or consolidating (it polls `/evo/status`). Clicking it opens the
Settings → Memory page.

The client half is carried by a no-op Loader row named by the bare package (`evo-web` in
`cordis.patch.yml`): the client-modules scan discovers `dsh.client` packages only through bare
package names, so a subpath row like `evo/cordis` cannot carry a web client. Restart Harness after
upgrading so the new boot graph includes the panel.

## Claude Code hook

evo also plugs into Claude Code (CLI and desktop, which share `~/.claude/settings.json`)
through its hook system — no Harness, no web server, no API key of its own.

Install it as a plugin:

```
/plugin marketplace add TIZ36/evo
/plugin install evo
```

or patch the settings file directly with the installer:

```bash
./install_evo_claude.sh              # install or upgrade, for every project
./install_evo_claude.sh --uninstall  # remove evo's entries again
```

Use one or the other. Both at once makes evo run twice per turn.

The installer builds the package and patches the user-level
`~/.claude/settings.json` (override the location with `CLAUDE_CONFIG_DIR`). It is
meant to be re-run: evo's own entries are replaced with the current set — hook
events added by a later version included — while every other hook in the file is
kept as it is. The previous file is copied to `settings.json.evo-backup` first,
and the installed command is probed before success is reported.

To wire it by hand instead, or to scope evo to a single repository through that
project's `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart":     [ { "hooks": [ { "type": "command", "command": "evo-hook", "timeout": 20 } ] } ],
    "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "evo-hook", "timeout": 20 } ] } ],
    "Stop":             [ { "hooks": [ { "type": "command", "command": "evo-hook", "timeout": 20 } ] } ]
  }
}
```

`hooks` entries are arrays, so this coexists with hooks you already run. A
copyable file is in [`examples/claude-code-settings.json`](examples/claude-code-settings.json).
`evo-hook` is the package's bin; from a local checkout use
`node /path/to/evo/dist/hook/cli.mjs` as the command instead. Installing both
globally and per-project makes evo run twice per turn — pick one.

| Event | What evo does |
| --- | --- |
| `SessionStart` | Imports the workspace's agent files, then prints recalled memory into the session |
| `UserPromptSubmit` | Prints global + project memory, which Claude Code injects as context |
| `Stop` | Hands the finished turn to a detached child process that distils it into memory |

Reflection runs through the local `claude -p` CLI, reusing the credentials Claude
Code already has (under Codex it is `codex exec` instead — see
[Codex plugin](#codex-plugin)). It takes several seconds, so the `Stop` hook returns
immediately and the work continues in a detached process — a session is never
blocked by evo. The child runs with `EVO_HOOK_DISABLE=1` so its own hooks exit at
once; without that guard reflection would recurse.

### As a plugin

The repository is also a plugin marketplace: `.claude-plugin/marketplace.json`
offers a single plugin whose source is [`plugin/`](plugin), holding both hosts'
manifests, `hooks/hooks.json`, and one dependency-free bundle at
`plugin/bin/hook.mjs`. [Codex](#codex-plugin) installs that same directory.

That bundle is committed on purpose. Both hosts install a plugin by copying the
repository: they run no build step, and Claude Code restores dependencies only
for npm and bun lockfiles, never pnpm. So the plugin has to be runnable exactly
as checked in — `pnpm build` regenerates it, `pnpm test` fails if it drifts from
the source, and the hook commands address it through
`${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}` (Codex exports the first, Claude Code the
second) so no machine path is ever written down.


### What you see

Recall is silent: memory arrives as context, not as UI noise. evo speaks in the
transcript only twice — through the hook's `systemMessage`, which Claude Code
renders as its own line:

- after a turn it learned from, on your next prompt: `evo · remembered 2, updated 1`
- when it is broken: `evo · memory unavailable: <reason>`

Reflection finishes after its turn is over, so its result is left as a
breadcrumb next to the database and reported once on the following prompt, then
cleared. `SessionStart` never reports it — Claude Code consumes that event's
output without rendering a system message.

Failures never interrupt a session: the hook always exits 0, and the full error
goes to `<dataDir>/hook.log`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `EVO_HOOK_REFLECT` | `1` | Set `0` to recall only and never write memory |
| `EVO_HOOK_IMPORT` | `1` | Set `0` to skip the workspace import on session start |
| `EVO_HOOK_MODEL` | `claude-haiku-4-5-20251001` under Claude Code, your own model under Codex | Model used for reflection |
| `EVO_HOOK_RECALL_LIMIT` | `40` | Memories considered per recall |
| `EVO_HOOK_MAX_CHARS` | `6000` | Character budget of the injected context |
| `EVO_HOOK_NOTIFY` | `1` | Set `0` to remove the transcript line entirely |
| `EVO_HOOK_DEBUG` | unset | Set `1` to log every recall, import and reflection |
| `EVO_HOOK_DISABLE` | unset | Set `1` to make the hook a no-op (used for the recursion guard) |
| `EVO_HOOK_HOST` | auto | `claude` or `codex`, when the host has to be forced |

Project memory is keyed by the canonical (symlink-resolved) working directory.
When a project moves, or was first recorded through a different path, re-point
its memories with:

```bash
node scripts/migrate-project-scope.mjs --from /old/path --to /new/path   # add --apply to write
node scripts/migrate-project-scope.mjs --canonicalize                    # add --apply to write
```

## Codex plugin

The same bundle is a Codex plugin. `plugin/` carries both manifests
(`.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`) over one
`hooks/hooks.json` and one `bin/hook.mjs`, and the repository is a marketplace
for either host — `.claude-plugin/marketplace.json` for Claude Code,
`.agents/plugins/marketplace.json` for Codex.

Install it the same way, from the CLI:

```bash
codex plugin marketplace add TIZ36/evo
codex plugin add evo@evo
```

or patch the hooks file directly with the installer:

```bash
./install_evo_codex.sh              # install or upgrade, for every project
./install_evo_codex.sh --uninstall  # remove evo's entries again
```

It writes `~/.codex/hooks.json` (override the location with `CODEX_HOME`) and is
re-runnable on the same terms as the Claude Code installer. Codex asks you to
trust a hook command the first time it runs one; until you say yes, evo stays
inert. Use the plugin or the installer, not both.

Three things differ from Claude Code, and evo handles all three itself:

- **The transcript.** Codex writes a rollout — `{ type, payload }` per line — so
  the turn is read from its event stream, where the prompt has no
  `<environment_context>` block and reasoning is already split off the answer.
  The format is detected from the transcript's own bytes, so one bundle serves
  both hosts.
- **Reflection.** It goes through `codex exec` instead of `claude -p`, again with
  no key of evo's own. With no `EVO_HOOK_MODEL`, the model is whatever your Codex
  configuration already selects — evo has no opinion worth hardcoding there.
- **`codex exec` runs no lifecycle hooks.** Hooks fire in the interactive CLI, so
  the reflection child cannot recurse even before the `EVO_HOOK_DISABLE` guard.
  It does, however, wait on piped stdin for input to append to the prompt, so
  evo closes it — otherwise every reflection would hang until its timeout.

Everything else is the same: the same SQLite file, the same scopes, the same
`systemMessage` line, the same variables in the table above.

## HTTP API

The Cordis plugin registers a raw route prefix on the DSH web server when the `webServer` service is
present (the `/api` prefix belongs to the DSH web transport, so a plugin bridge uses its own path).
These endpoints are the reserved integration surface for external frontends:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/evo/status` | `{ ok, databasePath, busy }` |
| GET | `/evo/memories` | List; query `scopeType`, `scopeId`, `scopeKey`, `kind` (comma list), `text`, `tags`, `limit` |
| GET | `/evo/memories/:id` | One memory or 404 |
| GET | `/evo/scopes` | Scope tree roots |
| GET | `/evo/events` | Recent activity log, newest first; query `limit` |
| POST | `/evo/consolidate` | Body `{ scope: { type, id? } }` → consolidation result |
| POST | `/evo/import-workspace` | Body `{ cwd, force? }` → workspace import result |

The web server binds loopback by default and every response is JSON. The same data backs the native
Settings panel. The pre-rename `/evo-memory/*` prefix stays mounted as an alias.

## Configuration

With no storage configuration, the SQLite database is created at:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/evo/memory.db` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/evo/memory.db` |
| Windows | `%APPDATA%\evo\memory.db` |

Override the directory with `EVO_DATA_DIR` or plugin config:

```yaml
config:
  dataDir: /srv/agent-memory
```

Override the complete database path when needed:

```yaml
config:
  databasePath: /srv/agent-memory/team-a.db
```

Precedence is `databasePath`, `dataDir`, `EVO_DATA_DIR`, `EVO_MEMORY_DATA_DIR` (legacy), then the
platform default.

| Variable | Purpose |
| --- | --- |
| `EVO_DATA_DIR` | Storage directory |
| `EVO_PROVIDER` | Harness provider used for reflection and consolidation |
| `EVO_MODEL` | Harness model used for reflection and consolidation |

## Migrating from `evo-memory`

Nothing is required beyond installing the new package name; the compatibility surface is:

- **Database.** If the platform default `evo/` directory has no `memory.db` but the pre-rename
  `evo-memory/` directory does, evo keeps using the old file. Move it to the new directory whenever
  you like — nothing else points at it.
- **Environment.** `EVO_MEMORY_DATA_DIR`, `EVO_MEMORY_PROVIDER`, and `EVO_MEMORY_MODEL` are still
  read, after their `EVO_*` counterparts.
- **HTTP.** `/evo-memory/*` still answers alongside `/evo/*`.

What does change: the package name (`evo`), the plugin rows (`evo/cordis`, `evo/deepseek`, and the
`evo-web` carrier), and the Cordis service key (`ctx.evo`, formerly `ctx.evoMemory`). Re-run the
installer, or update the plugin names in a hand-written `cordis.patch.yml`.

## Service API

The Cordis plugin registers `ctx.evo`:

```ts
await ctx.evo.remember({
  scope: { type: 'project', id: '/workspace/app' },
  kind: 'constraint',
  title: 'Verification',
  content: 'Run the full check command before reporting completion.',
})

const items = await ctx.evo.recall({
  scopes: [{ type: 'project', id: '/workspace/app' }],
  text: 'verification',
})

await ctx.evo.consolidate({ type: 'project', id: '/workspace/app' })
```

The core exports `MemoryStore`, `ModelRunner`, `MemoryMaterializer`, and `MemoryEventSink`. SQLite
and DeepSeek Harness are implementations behind those interfaces, not dependencies of the memory
domain model.

## Memory scopes

The core supports `global`, `user`, `project`, `session`, and `conversation` scopes. The DeepSeek
adapter writes completed-turn reflection to the project scope when `session.header.cwd` exists, and
to the global scope otherwise. Recall combines global, project, and current-session scopes.

## Privacy and safety

Reflection prompts explicitly reject secrets, credentials, raw logs, guesses, and transient task
state. The SQLite database stays local. Model-based reflection still sends the completed turn to the
configured Harness model provider — disable it with `reflect: false` when that is not acceptable.

Materialized Markdown is deliberately not a source of truth in v1. Structured storage remains
authoritative.

## Limitations

- Recall is deterministic SQLite filtering and ranking, without embeddings.
- Reflection runs once per successful turn; queueing and sleep consolidation are not included yet.
- Consolidation is not scheduled automatically; call `consolidate()` explicitly.
- Claude Code and Codex are supported through the hook plugin; there are no Paper, MCP,
  remote-store, or synchronization adapters yet.
- `node:sqlite` is still marked experimental by current Node releases even though it ships with
  Node 22+.

## Development

```bash
pnpm install
pnpm check          # test + typecheck + build + rule scan
pnpm pack --dry-run
```

The design authority is [`docs/reference/evo-reference.md`](docs/reference/evo-reference.md).
Open-source boundaries and storage decisions are recorded in
[`docs/design-principles.md`](docs/design-principles.md) and
[`docs/storage-architecture.md`](docs/storage-architecture.md).

Contributions are welcome — please run `pnpm check` before opening a pull request, and keep changes
scoped to one topic per PR.

### Project rule

This is a personal open-source project. Company identity and sensitive information — company names,
brands, domains, mailboxes, employee names, internal codenames, intranet addresses, or machine
absolute paths — must never appear anywhere in the repository, including built artifacts. Team
attribution is "Paper team" only. The rule is enforced by
[`scripts/iron-rule.mjs`](scripts/iron-rule.mjs): the source tree is checked on `pnpm test`, and the
full tree including `dist/` is checked by `pnpm check`.

## License

[MIT](LICENSE) © TIZ36
