---
description: Browse evo Memory catalog
allowed-tools: Bash(node:*)
---

Show the evo Memory catalog for this project.

Run `node --no-warnings "${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT}}/bin/hook.mjs" list-memory --cwd="$PWD"` and display the output.

Memory contains durable facts, preferences, constraints, and procedures that evo distilled from your work sessions or imported from workspace files. Each entry shows:
- **title**: The memory name
- **content**: A brief summary
- **scope**: global (applies everywhere) or project (this directory)
- **source**: evo (distilled), workspace-import (from files), or other runtime
- **uses**: How many times this memory has been recalled
- **path**: Source file path for imported memories
