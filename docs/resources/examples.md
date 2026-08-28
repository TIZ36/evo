# Examples

Configuration examples for different hosts and use cases.

## DeepSeek Harness

### Basic Setup

**`cordis.patch.yml`**:

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

- id: evo-web
  name: evo
  config: {}
```

See: [`examples/cordis.yml`](https://github.com/TIZ36/evo/blob/main/examples/cordis.yml)

### Custom Storage

```yaml
- id: evo
  name: evo/cordis
  config:
    dataDir: /srv/agent-memory

# Or specific database path
- id: evo
  name: evo/cordis
  config:
    databasePath: /srv/agent-memory/team-a.db
```

### Read-Only Mode

Recall memories but never write new ones:

```yaml
- id: evo-deepseek
  name: evo/deepseek
  config:
    provider: deepseek-official
    model: deepseek-chat
    reflect: false
```

## Claude Code

### User-Level Hooks

**`~/.claude/settings.json`**:

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

See: [`examples/claude-code-settings.json`](https://github.com/TIZ36/evo/blob/main/examples/claude-code-settings.json)

### Project-Specific

**`.claude/settings.json`** in your project:

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

### Local Checkout

When using a local checkout instead of npm:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /path/to/evo/dist/hook/cli.mjs", "timeout": 20 }] }
    ]
  }
}
```

## Codex

### User-Level Hooks

**`~/.codex/hooks.json`**:

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

See: [`examples/codex-hooks.json`](https://github.com/TIZ36/evo/blob/main/examples/codex-hooks.json)

## Environment Variables

### Fast Feedback (Smaller Batches)

```bash
export EVO_HOOK_BATCH_TURNS=3
export EVO_HOOK_BATCH_IDLE_MS=60000  # 1 minute
```

### More Context Per Turn

```bash
export EVO_HOOK_TURN_USER_CHARS=800
export EVO_HOOK_TURN_ASSISTANT_CHARS=1200
export EVO_HOOK_MAX_CHARS=10000
```

### Debug Logging

```bash
export EVO_HOOK_DEBUG=1
```

### Recall Only (No Reflection)

```bash
export EVO_HOOK_REFLECT=0
```

### Skip Workspace Import

```bash
export EVO_HOOK_IMPORT=0
```

## Programmatic Usage

### Remember a Fact

```ts
await ctx.evo.remember({
  scope: { type: 'project', id: '/workspace/app' },
  kind: 'fact',
  title: 'Database connection',
  content: 'Use connection pool size of 10 for production.',
  tags: ['database', 'production']
})
```

### Recall with Filters

```ts
const items = await ctx.evo.recall({
  scopes: [{ type: 'project', id: '/workspace/app' }],
  kinds: ['constraint', 'procedure'],
  text: 'deploy',
  limit: 10
})
```

### Force Workspace Re-import

```ts
await ctx.evo.importWorkspace('/workspace/app', { force: true })
```

### Trigger Consolidation

```ts
const result = await ctx.evo.consolidate({
  type: 'project',
  id: '/workspace/app'
})
console.log(`Consolidated ${result.before} → ${result.after} items`)
```
