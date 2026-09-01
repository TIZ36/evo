---
description: Browse evo Memory and Skills catalog
allowed-tools: Bash(node:*)
---

Show the evo Memory and Skills catalog for this project.

Run `node --no-warnings "${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT}}/bin/hook.mjs" list --cwd="$PWD"` and display the output.

The catalog shows:
- **Skills**: Reusable procedures evo learned or discovered on disk (SKILL.md files)
- **Memory**: Facts, preferences, and constraints evo remembers

Each entry shows its name, trigger/description, path (for disk files), scope (global or project), source, and usage count.
