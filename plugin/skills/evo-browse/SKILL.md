---
name: evo-browse
description: Browse the evo Memory and Skills catalog for this project
allow_implicit_invocation: false
---

## Purpose

Provide a way to browse evo's Memory and Skills catalog without opening DeepSeek Harness. Shows all learned memories and discovered skills (including disk SKILL.md files with Chinese/Unicode names) with their real paths.

## When to use

- User asks to see what evo remembers or knows
- User wants to list evo skills or memories
- User asks about the evo catalog, memory list, or skill list
- Explicitly invoked with `$evo-browse`

## Steps

1. Determine what the user wants to see:
   - "all" / "catalog" / "both" → use `list` subcommand
   - "skills" only → use `list-skills` subcommand  
   - "memory" / "memories" only → use `list-memory` subcommand

2. Run the appropriate evo-hook command:

   For the full catalog:
   ```bash
   node --no-warnings "${CODEX_PLUGIN_ROOT:-${PLUGIN_ROOT}}/bin/hook.mjs" list --cwd="$PWD"
   ```

   For skills only:
   ```bash
   node --no-warnings "${CODEX_PLUGIN_ROOT:-${PLUGIN_ROOT}}/bin/hook.mjs" list-skills --cwd="$PWD"
   ```

   For memory only:
   ```bash
   node --no-warnings "${CODEX_PLUGIN_ROOT:-${PLUGIN_ROOT}}/bin/hook.mjs" list-memory --cwd="$PWD"
   ```

3. Display the output, which shows:
   - **Skills section**: name, trigger, path (real disk path for SKILL.md files), scope, source, usage count, promoted/dormant flags
   - **Memory section**: title, content summary, scope, source, usage count, source path for imported files

## Verification

The output is plain text formatted for terminal reading:
- No emoji badges or cards
- Real file paths visible (including ~/... for home directory)
- Provenance clear (source: evo, human, disk, or workspace-import)
- Skills sorted by promoted status then usage count
- Memories sorted by usage count
