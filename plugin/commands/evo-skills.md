---
description: Browse evo Skills catalog
allowed-tools: Bash(node:*)
---

Show the evo Skills catalog for this project.

Run `node --no-warnings "${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT}}/bin/hook.mjs" list-skills --cwd="$PWD"` and display the output.

Skills are reusable procedures that evo learned from your work sessions or discovered as SKILL.md files on disk. Each entry shows:
- **name**: The skill identifier
- **trigger**: When to use this skill
- **path**: File path for disk-discovered skills (may include Chinese/Unicode names)
- **scope**: global (applies everywhere) or project (this directory)
- **source**: evo (learned), human (imported), or disk (discovered)
- **uses**: How many times this skill has been applied

Promoted skills (frequently used) appear first. Dormant skills (unused for a long time) are marked.
