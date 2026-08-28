# Environment Variables

evo is configured primarily through environment variables, making it easy to customize behavior without modifying files.

## Storage

| Variable | Default | Description |
| --- | --- | --- |
| `EVO_DATA_DIR` | Platform default | Directory for SQLite database and logs |
| `EVO_MEMORY_DATA_DIR` | — | Legacy name, still supported |

Default storage locations:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/evo/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/evo/` |
| Windows | `%APPDATA%\evo\` |

## Model Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `EVO_PROVIDER` | Varies by host | Harness provider for reflection/consolidation |
| `EVO_MODEL` | Varies by host | Model for reflection/consolidation |
| `EVO_MEMORY_PROVIDER` | — | Legacy name, still supported |
| `EVO_MEMORY_MODEL` | — | Legacy name, still supported |

## Hook Configuration

These apply to Claude Code and Codex integrations:

### Core Behavior

| Variable | Default | Description |
| --- | --- | --- |
| `EVO_HOOK_REFLECT` | `1` | Set `0` to recall only, never write memory |
| `EVO_HOOK_IMPORT` | `1` | Set `0` to skip workspace import on session start |
| `EVO_HOOK_NOTIFY` | `1` | Set `0` to remove the transcript system message |
| `EVO_HOOK_DEBUG` | unset | Set `1` to log every recall, import, and reflection |
| `EVO_HOOK_DISABLE` | unset | Set `1` to make the hook a no-op (recursion guard) |
| `EVO_HOOK_HOST` | auto | Force `claude` or `codex` when auto-detection fails |

### Recall Settings

| Variable | Default | Description |
| --- | --- | --- |
| `EVO_HOOK_RECALL_LIMIT` | `40` | Maximum memories considered per recall |
| `EVO_HOOK_MAX_CHARS` | `6000` | Character budget for injected context |
| `EVO_HOOK_MODEL` | `claude-haiku-4-5-20251001` (Claude Code) | Model for reflection |

### Batch Distillation

| Variable | Default | Description |
| --- | --- | --- |
| `EVO_HOOK_BATCH_TURNS` | `10` | Turns to gather before distilling; `1` for turn-by-turn |
| `EVO_HOOK_BATCH_CHARS` | `12000` | Character threshold to trigger batch |
| `EVO_HOOK_BATCH_IDLE_MS` | `300000` | Idle time (5 min) after which next event settles batch |

### Turn Trimming

Turns are trimmed before batching to fit memory budget:

| Variable | Default | Description |
| --- | --- | --- |
| `EVO_HOOK_TURN_USER_CHARS` | `400` | Characters kept from each user message |
| `EVO_HOOK_TURN_ASSISTANT_CHARS` | `600` | Characters kept from each assistant message |
| `EVO_HOOK_TURN_TOOLS` | `20` | Tool names kept per turn |

## Example Configuration

```bash
# Smaller batches for faster feedback
export EVO_HOOK_BATCH_TURNS=5

# More context in each turn
export EVO_HOOK_TURN_USER_CHARS=800
export EVO_HOOK_TURN_ASSISTANT_CHARS=1000

# Verbose logging for debugging
export EVO_HOOK_DEBUG=1

# Custom storage location
export EVO_DATA_DIR=/srv/agent-memory
```

## Precedence

When multiple sources provide the same setting:

1. Explicit runtime configuration (plugin config)
2. Environment variable
3. Legacy environment variable (if applicable)
4. Platform default
