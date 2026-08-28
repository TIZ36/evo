# Memory Scopes

evo organizes memory into hierarchical scopes that control where knowledge applies and when it's recalled.

## Scope Types

| Scope | Key | Description |
| --- | --- | --- |
| `global` | — | Applies everywhere, across all projects and sessions |
| `user` | user identifier | User-specific preferences and facts |
| `project` | directory path | Knowledge tied to a specific working directory |
| `session` | session identifier | Context valid only for the current conversation |
| `conversation` | conversation identifier | Finer-grained than session, if needed |

## Scope Hierarchy

When recalling memory, evo combines items from multiple scopes in order of specificity:

```
global
  └── user
        └── project
              └── session
                    └── conversation
```

More specific scopes can override more general ones. A project constraint takes precedence over a global default.

## Project Scope

The most commonly used scope. Project memory is keyed by the **canonical working directory** — the symlink-resolved absolute path.

When you work in `~/projects/myapp`:
- That path becomes the project scope key
- All sessions in that directory share the same project memory
- Memory persists across sessions, restarts, and even different hosts

### Path Normalization

evo resolves symlinks to avoid duplicate project scopes. If you access the same project via different paths:

```bash
~/myapp           # original
/tmp/myapp -> ~/myapp  # symlink
```

Both resolve to `~/myapp` and share the same memory.

### Migrating Projects

If a project moves, migrate its memory:

```bash
node scripts/migrate-project-scope.mjs --from /old/path --to /new/path --apply
```

To canonicalize all existing paths:

```bash
node scripts/migrate-project-scope.mjs --canonicalize --apply
```

## How Scopes Are Used

### DeepSeek Harness

- Reflects to project scope when `session.header.cwd` exists
- Falls back to global scope otherwise
- Recalls from global + project + current session

### Claude Code / Codex

- Uses the hook's working directory as project scope
- Recalls global + project memory on each prompt
- Session scope tracks the current conversation

## Scope in Memory Items

Every memory item has a scope field:

```ts
{
  scope: {
    type: 'project',
    id: '~/projects/myapp'
  },
  kind: 'constraint',
  title: 'Testing requirement',
  content: 'Always run pnpm check before committing.'
}
```

The scope determines:
- When the item is recalled
- What other items it might conflict with
- Where it appears in the memory panel
