# Claude Code

evo integrates with Claude Code (CLI and desktop) through its hook system — no Harness, no web server, no API key of its own. Reflection runs through `claude -p`, reusing the credentials Claude Code already has.

## Installation via Plugin Marketplace

```bash
/plugin marketplace add TIZ36/evo
/plugin install evo
```

## Installation via Installer Script

```bash
./install_evo_claude.sh              # install or upgrade
./install_evo_claude.sh --uninstall  # remove evo's entries
```

The installer builds the package and patches `~/.claude/settings.json` (override with `CLAUDE_CONFIG_DIR`). It preserves other hooks in the file and creates a backup at `settings.json.evo-backup`.

**Use the marketplace or the installer, not both** — running both makes evo execute twice per turn.

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

Recall is silent — memory arrives as context. evo speaks in the transcript only through the hook's `systemMessage`:

- After a turn it learned from: `evo · remembered 2, updated 1`
- When broken: `evo · memory unavailable: <reason>`

Failures never interrupt a session: the hook always exits 0, with errors logged to `<dataDir>/hook.log`.

## Environment Variables

See [Environment Variables](../configuration/environment-variables.md) for the full list. Key variables for Claude Code:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EVO_HOOK_REFLECT` | `1` | Set `0` to recall only |
| `EVO_HOOK_MODEL` | `claude-haiku-4-5-20251001` | Model for reflection |
| `EVO_HOOK_BATCH_TURNS` | `10` | Turns before batch distillation |
| `EVO_HOOK_BATCH_IDLE_MS` | `300000` | Idle time (5 min) to trigger batch |

## Migrating Project Paths

Project memory is keyed by canonical (symlink-resolved) working directory. If a project moves:

```bash
node scripts/migrate-project-scope.mjs --from /old/path --to /new/path --apply
node scripts/migrate-project-scope.mjs --canonicalize --apply
```
