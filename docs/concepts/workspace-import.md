# Workspace Import

When a session opens in a project directory, evo imports existing agent memory files into the project scope. This imported knowledge is then recalled like any other memory.

Skill files are **not** imported. A `SKILL.md` reaches the model as a catalog entry (name, trigger, path) discovered from disk at recall time — see [Skills vs Memories](skills-vs-memories.md). Copying its body into a memory row would duplicate what is already on disk, and memories render inline while skills render as one line.

## What Gets Imported

| File / Directory | Memory Kind |
| --- | --- |
| `CLAUDE.md`, `.claude/CLAUDE.md` | fact |
| `AGENTS.md`, `agents.md`, `.agent/AGENTS.md` | constraint |
| `.paper/AGENT_MEMORY.md`, `.paper/**/*.md` | fact |
| `.claude/commands/**/*.md`, `.claude/agents/**/*.md` | procedure |
| `.codex/**/*.md`, `.copilot/instructions/**/*.md`, `.copilot/prompts/**/*.md`, `.agent/**/*.md` | constraint |

## How Import Works

Each imported file becomes one memory item with:

- **Title**: Path relative to the workspace root
- **Tags**: `workspace-import` plus `tool:<tool>` (e.g., `tool:claude`)
- **Source**: `runtime: 'workspace-import'` and the absolute file path

### What's Skipped

- YAML frontmatter is stripped
- `SKILL.md` files, wherever they sit — they belong to the disk-skill catalog
- Everything under `.paper/agents/skills/` — evo's own skills, owned by the skills table
- Cache directories: `.tmp/`, `node_modules/`, `.git/`
- `*.memory.md` skill-experience files are skipped
- Empty documents are skipped

### Idempotent Updates

Import is idempotent:

- Items are upserted by `(project scope, title)`
- Changed files update existing items in place
- Rows whose file has disappeared are pruned — an import row is a projection of a
  file, and a projection of nothing is noise

Pruning keys on `source.runtime`, never on the `workspace-import` tag: a memory
evo distilled *about* importing can carry that tag and has no file behind it.

A project is imported once on first session start. To force a re-import:

```ts
await ctx.evo.importWorkspace('/workspace/app', { force: true })
```

Or via HTTP API:

```bash
curl -X POST http://localhost:3000/evo/import-workspace \
  -H "Content-Type: application/json" \
  -d '{"cwd": "/workspace/app", "force": true}'
```

## Why This Design

Imported workspace files are a **projection of what exists on disk**. evo treats them as read-only references:

- They're recalled alongside evo's own memories
- They're never modified by reflection
- They're never evicted by capacity limits

This ensures your hand-written rules and procedures remain authoritative. One reflection can't accidentally delete your `CLAUDE.md` guidance.

## Disabling Import

In DeepSeek Harness, set in plugin config:

```yaml
- id: evo-deepseek
  name: evo/deepseek
  config:
    workspaceImport: false
```

In Claude Code / Codex, set environment variable:

```bash
export EVO_HOOK_IMPORT=0
```
