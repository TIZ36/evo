# Plugin Configuration

DeepSeek Harness uses YAML configuration in `cordis.patch.yml`. Claude Code and Codex are configured entirely through environment variables.

## DeepSeek Harness

### Core Plugin

```yaml
- id: evo
  name: evo/cordis
  config: {}
```

The core plugin provides the memory store service (`ctx.evo`) with no required configuration.

### DeepSeek Adapter

```yaml
- id: evo-deepseek
  name: evo/deepseek
  config:
    provider: deepseek-official
    model: deepseek-chat
    recallLimit: 40
    maxContextChars: 6000
    reflect: true
    workspaceImport: true
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | string | — | Harness provider for reflection calls |
| `model` | string | — | Model for reflection and consolidation |
| `recallLimit` | number | `40` | Maximum memories per recall |
| `maxContextChars` | number | `6000` | Character budget for context |
| `reflect` | boolean | `true` | Enable reflection on turn end |
| `workspaceImport` | boolean | `true` | Import workspace files on session start |

### Web Panel

```yaml
- id: evo-web
  name: evo
  config: {}
```

The web panel carrier uses the bare package name so the DSH client-modules scan discovers the `dsh.client` bundle. No configuration options.

### Storage Override

Override the default storage path:

```yaml
- id: evo
  name: evo/cordis
  config:
    dataDir: /srv/agent-memory
```

Or specify the complete database path:

```yaml
- id: evo
  name: evo/cordis
  config:
    databasePath: /srv/agent-memory/team-a.db
```

Precedence: `databasePath` > `dataDir` > `EVO_DATA_DIR` > platform default.

## Complete Example

```yaml
# Load after Harness LLM and system-prompt services
- id: evo
  name: evo/cordis
  config:
    dataDir: /srv/memory

- id: evo-deepseek
  name: evo/deepseek
  config:
    provider: deepseek-official
    model: deepseek-chat
    recallLimit: 50
    maxContextChars: 8000
    reflect: true
    workspaceImport: true

- id: evo-web
  name: evo
  config: {}
```

## Claude Code / Codex

These hosts use hook commands with no plugin configuration layer. All settings come from environment variables.

See [Environment Variables](environment-variables.md) for the complete list.

### Per-Project Settings

To scope settings to a single project, set variables in your shell profile or project's `.envrc`:

```bash
# .envrc for a specific project
export EVO_HOOK_BATCH_TURNS=3
export EVO_HOOK_REFLECT=1
```

Or configure hooks only for that project in `.claude/settings.json` or `.codex/hooks.json`.
