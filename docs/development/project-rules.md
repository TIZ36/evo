# Project Rules

evo is a personal open-source project with specific rules to maintain its independence and safety.

## The Iron Rule

**No company information or sensitive data** may appear anywhere in the repository:

- Company names, brands, domains, or email addresses
- Employee names or aliases
- Internal system codenames
- Intranet addresses
- Machine absolute paths (use relative paths or `~/`)

Team attribution is **"Paper team"** only — no company identity.

## Enforcement

The rule is enforced by `scripts/iron-rule.mjs`:

| Check | When | What |
| --- | --- | --- |
| `pnpm test` | Source tree | Tests include iron-rule scan |
| `pnpm check` | Full tree + `dist/` | Post-build verification |

Violations fail the build. The scan checks for:

- Known company name patterns
- User home directory absolute paths
- Private IP addresses (10.x, 172.16-31.x, 192.168.x)

## Adding New Patterns

If you discover a pattern that should be blocked, add it to `FORBIDDEN_PATTERNS` in `scripts/iron-rule.mjs`:

```js
export const FORBIDDEN_PATTERNS = [
  { name: 'example:pattern', note: 'Description', regex: /pattern/i },
  // ... existing patterns
]
```

## Why This Rule?

This project is open source and must remain independent of any corporate identity. The rule ensures:

- No accidental leakage of internal information
- Clear separation between personal and corporate work
- Safe for anyone to fork and use

## Skipped Locations

The scan skips:

- `.git/` — version control internals
- `node_modules/` — third-party code
- `.vitest/`, `coverage/` — test artifacts
- `.paper/` — runtime data directory
- Binary files — only text files are scanned
- `scripts/iron-rule.mjs` itself — contains the patterns

## Practical Guidelines

### Paths

```js
// Bad: hardcoded absolute path
const config = '/absolute/path/to/config.json'

// Good: use homedir() or relative paths
const config = path.join(homedir(), '.evo', 'config.json')
// or
const config = './config.json'
```

### Attribution

```markdown
<!-- Bad -->
Developed by Example Corp Engineering Team

<!-- Good -->
Developed by the Paper team.
```

### Examples

When writing examples or documentation, use generic paths:

```bash
# Good: generic paths or ~/
export EVO_DATA_DIR=/srv/agent-memory
cd ~/projects/myapp

# Bad: absolute paths with usernames
cd /absolute/username/work/project
```
