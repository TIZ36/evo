# Codex

evo integrates with Codex as a hook plugin, sharing the same bundle as Claude Code. Reflection runs through `codex exec` using your existing Codex configuration.

## Installation via Plugin Marketplace

```bash
codex plugin marketplace add TIZ36/evo
codex plugin add evo@evo
```

## Installation via Installer Script

```bash
./install_evo_codex.sh              # install or upgrade
./install_evo_codex.sh --uninstall  # remove evo's entries
```

The installer writes `~/.codex/hooks.json` (override with `CODEX_HOME`). Codex asks you to trust a hook command the first time it runs; until you confirm, evo stays inert.

**Use the marketplace or the installer, not both.**

## Browse Memory and Skills

Use the `$evo-browse` skill to browse evo's catalog without opening DeepSeek Harness:

```
$evo-browse
```

Or ask directly: "Show me evo's skills" / "List what evo remembers"

The output shows each entry with its name, trigger/description, real file path (for disk-discovered SKILL.md files, including Chinese/Unicode names), scope (global or project), source, and usage count. Promoted skills appear first.

You can also run the CLI directly in any terminal:

```bash
evo-hook list           # Full catalog
evo-hook list-skills    # Skills only
evo-hook list-memory    # Memory only
evo-hook list --cwd=/path/to/project  # Specify project directory
```

## Differences from Claude Code

Three things differ from Claude Code, and evo handles all automatically:

### Transcript Format

Codex writes a rollout (`{ type, payload }` per line) instead of Claude Code's format. The turn is read from Codex's event stream, where the prompt has no `<environment_context>` block and reasoning is already split from the answer. evo auto-detects the format.

### Reflection Model

Reflection runs through `codex exec` instead of `claude -p`. With no `EVO_HOOK_MODEL` set, the model is whatever your Codex configuration selects — evo has no opinion to hardcode.

### No Hook Recursion

`codex exec` runs no lifecycle hooks, so reflection cannot recurse even before the `EVO_HOOK_DISABLE` guard. However, it waits on piped stdin, so evo closes it to prevent hangs.

## Hook Events

Same as Claude Code:

| Event | What evo Does |
| --- | --- |
| `SessionStart` | Settles batches, imports workspace files, prints recalled memory |
| `UserPromptSubmit` | Settles project batch if idle, prints memory as context |
| `Stop` | Queues turn, distils batch when threshold reached |

## What You See

evo's only visible surface is the transcript, via the hook's `systemMessage`. Codex has no composer chip or statusline equivalent that plugins can contribute to.

| State | What appears |
| --- | --- |
| **Idle / recall** | Nothing. Memory arrives as context; the transcript stays silent. |
| **Learned something** | `evo · remembered 2, updated 1` — one receipt on the next `UserPromptSubmit`, then consumed. |
| **Broken** | `evo · memory unavailable: <reason>` — one error line on the next `UserPromptSubmit`, then consumed. |

Notices are `UserPromptSubmit`-only: a `SessionStart` defers any pending receipt or error to the first actual prompt in the session. Failures also log to `<dataDir>/hook.log`.

## Everything Else

Same SQLite file, same scopes, same `systemMessage` output, same environment variables. See:

- [Environment Variables](../configuration/environment-variables.md)
- [Batch Distillation](../concepts/batch-distillation.md)
