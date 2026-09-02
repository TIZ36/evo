# Codex

evo integrates with Codex as a hook plugin, sharing the same bundle as Claude Code. Reflection runs through `codex exec` using your existing Codex configuration.

## Choose One Install Method

**Use the marketplace plugin OR the installer script, not both.** Running both makes evo execute twice per turn, doubling memory writes and model calls.

### Option A: Plugin Marketplace (Recommended)

```bash
codex plugin marketplace add TIZ36/evo
codex plugin add evo@evo
```

The marketplace plugin is self-contained and updates with the plugin system. Choose this if you want the simplest setup.

### Option B: Installer Script

```bash
./install_evo_codex.sh              # install or upgrade
./install_evo_codex.sh --uninstall  # remove evo's entries
```

The installer writes `~/.codex/hooks.json` (override with `CODEX_HOME`). Codex asks you to trust a hook command the first time it runs; until you confirm, evo stays inert.

Choose the script if you want to run from a local checkout or need more control over the build.

## Upgrade Behavior

**Re-running the installer is the supported upgrade path.** It:

1. Removes all existing evo hooks (both plugin-style and script-style)
2. Installs the current set of hook events
3. Preserves all non-evo hooks in the file

This ensures exactly one evo hook per event after upgrade, even if you previously installed a different version or switched between plugin and script.

## Conflict Detection

The installer detects and refuses to run when conflicts would cause double execution:

### Plugin + Script Conflict

If the marketplace plugin is already installed, the script refuses with:

```
evo: marketplace plugin is already installed at ~/.codex/plugins/evo-abc123
     Using both plugin and script would run evo twice per turn.

     To use this script instead, first remove the plugin:
       codex plugin remove evo
     Then run this script again.
```

### Global + Project Conflict

If you install globally and the current project has evo hooks in `.codex/hooks.json` or `codex.hooks.json`, the installer warns:

```
evo: WARNING: project-level evo hooks found in .codex/hooks.json
     Global + project hooks will run evo twice per turn.
     Remove the project hooks to avoid double execution.
```

## Uninstalling

To fully remove evo:

- **Plugin install:** `codex plugin remove evo`
- **Script install:** `./install_evo_codex.sh --uninstall`

If you installed both (accidentally), run both uninstall commands.

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
