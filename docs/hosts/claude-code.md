# Claude Code

evo integrates with Claude Code (CLI and desktop) through its hook system — no Harness, no web server, no API key of its own. Reflection runs through `claude -p`, reusing the credentials Claude Code already has.

## Choose One Install Method

**Use the marketplace plugin OR the installer script, not both.** Running both makes evo execute twice per turn, doubling memory writes and model calls.

### Option A: Plugin Marketplace (Recommended)

```bash
/plugin marketplace add TIZ36/evo
/plugin install evo
```

The marketplace plugin is self-contained and updates automatically. Choose this if you want the simplest setup.

### Option B: Installer Script

```bash
./install_evo_claude.sh              # install or upgrade
./install_evo_claude.sh --uninstall  # remove evo's entries
```

The installer builds the package and patches `~/.claude/settings.json` (override with `CLAUDE_CONFIG_DIR`). It preserves other hooks in the file and creates a backup at `settings.json.evo-backup`.

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
evo: marketplace plugin is already installed at ~/.claude/plugins/evo-abc123
     Using both plugin and script would run evo twice per turn.

     To use this script instead, first remove the plugin:
       /plugin uninstall evo
     Then run this script again.
```

### Global + Project Conflict

If you install globally and the current project has evo hooks in `.claude/settings.local.json`, the installer warns:

```
evo: WARNING: project-level evo hooks found in .claude/settings.local.json
     Global + project hooks will run evo twice per turn.
     Remove the project hooks to avoid double execution:
       rm ".claude/settings.local.json"
```

## Uninstalling

To fully remove evo:

- **Plugin install:** `/plugin uninstall evo`
- **Script install:** `./install_evo_claude.sh --uninstall`

If you installed both (accidentally), run both uninstall commands.

## Browse Memory and Skills

Use the slash commands to browse evo's catalog without opening DeepSeek Harness:

| Command | Description |
| --- | --- |
| `/evo` | Show full catalog (Skills + Memory) |
| `/evo-skills` | Show Skills only |
| `/evo-memory` | Show Memory only |

The output shows each entry with its name, trigger/description, real file path (for disk-discovered SKILL.md files, including Chinese/Unicode names), scope (global or project), source, and usage count. Promoted skills appear first.

You can also run the CLI directly:

```bash
evo-hook list           # Full catalog
evo-hook list-skills    # Skills only
evo-hook list-memory    # Memory only
evo-hook list --cwd=/path/to/project  # Specify project directory
```

## Manual Configuration

Add to `~/.claude/settings.json` or a project's `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "evo-hook", "timeout": 20 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "evo-hook", "timeout": 20 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "evo-hook", "timeout": 20 }] }
    ]
  }
}
```

A copyable file is in [`examples/claude-code-settings.json`](https://github.com/TIZ36/evo/blob/main/examples/claude-code-settings.json).

For a local checkout, use `node /path/to/evo/dist/hook/cli.mjs` as the command.

## Hook Events

| Event | What evo Does |
| --- | --- |
| `SessionStart` | Settles any batch left waiting, imports workspace files, prints recalled memory |
| `UserPromptSubmit` | Settles the project's batch if idle, prints global + project memory as context |
| `Stop` | Queues the finished turn, distils the batch when it reaches threshold |

## What You See

evo's only visible surface is the transcript, via the hook's `systemMessage`. There is no composer chip, statusline, or persistent indicator — Claude Code's `statusLine` setting requires manual user configuration and plugins cannot contribute to it directly.

| State | What appears |
| --- | --- |
| **Idle / recall** | Nothing. Memory arrives as context; the transcript stays silent. |
| **Learned something** | `evo · remembered 2, updated 1` — one receipt on the next `UserPromptSubmit`, then consumed. |
| **Broken** | `evo · memory unavailable: <reason>` — one error line on the next `UserPromptSubmit`, then consumed. |

Notices are `UserPromptSubmit`-only: a `SessionStart` defers any pending receipt or error to the first actual prompt in the session.

Failures never interrupt a session: the hook always exits 0, with errors also logged to `<dataDir>/hook.log`.

## Environment Variables

See [Environment Variables](../configuration/environment-variables.md) for the full list. Key variables for Claude Code:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EVO_HOOK_REFLECT` | `1` | Set `0` to recall only |
| `EVO_HOOK_MODEL` | `claude-haiku-4-5-20251001` | Model for reflection |
| `EVO_HOOK_BATCH_TURNS` | `10` | Turns before batch distillation |
| `EVO_HOOK_BATCH_IDLE_MS` | `300000` | Idle time (5 min) to trigger batch |

## Picking Up Hook Updates

Marketplace users receive hook changes after the rebuilt `plugin/bin/hook.mjs` is committed to the branch they installed from. To update:

1. Update or reinstall the plugin via the marketplace
2. The new hook bundle takes effect on the next session

Installer-script users already run `pnpm build` inside `install_evo_claude.sh`, so their `dist/hook/cli.mjs` is fresh on each script run — no manual update needed.

## Migrating Project Paths

Project memory is keyed by canonical (symlink-resolved) working directory. If a project moves:

```bash
node scripts/migrate-project-scope.mjs --from /old/path --to /new/path --apply
node scripts/migrate-project-scope.mjs --canonicalize --apply
```
