# Credential Scanning

evo scans content for credential-like patterns before writing to disk. This prevents accidental persistence of secrets, API keys, tokens, and other sensitive data in skill files, lessons, or memory catalogs.

## How It Works

When evo writes content via:
- `materializeSkill` (SKILL.md and .memory.md files)
- `updateCatalog` (AGENT_MEMORY.md)
- `reflectBatch` (memory and skill content)
- `useSkill` (lesson text)

The content is scanned for credential patterns. If a match is found:
1. The write is **skipped** (not thrown)
2. A warning is logged with redacted preview
3. The calling operation continues without the sensitive content

## Detected Patterns

| Type | Examples |
|------|----------|
| Private Keys | PEM blocks (RSA, EC, OpenSSH) |
| API Keys | `sk-*`, `AIza*`, `ghp_*`, `gho_*`, `xox*-*`, `AKIA*`, `npm_*`, `pypi-*` |
| Tokens | Bearer tokens, authorization headers |
| Passwords | Password/passwd/pwd assignment patterns |
| JWT | Base64-encoded JWT tokens |
| Encoded Secrets | Long base64 strings |

## Fixture Detection

Test and placeholder values are automatically allowed:
- `sk-test-*`, `sk-fake-*`, `sk-mock-*`
- `test-api-key`, `fake-token`, `YOUR_API_KEY_HERE`
- Known example keys like `AKIAIOSFODNN7EXAMPLE`
- Repeated characters (`xxx...`, `000...`, `aaa...`)

## Configuration

The scanner is enabled by default with no configuration required. Logging uses `console.warn` and can be observed in the host process logs.

## Testing

To verify credential scanning in tests, use the logger override:

```typescript
import { setCredentialSkipLogger } from 'evo/workspace/skill-materializer'

it('skips writing credentials', () => {
  const logs: string[] = []
  const restore = setCredentialSkipLogger((ctx) => logs.push(ctx))
  
  try {
    materializeSkill(cwd, skillWithSecret, [])
    expect(logs).toContain('skill/secret-skill/body')
  } finally {
    restore()
  }
})
```

## Best Practices

1. **Never hardcode secrets** in skill steps or lessons
2. **Use environment variables** for configuration that varies
3. **Test with fixture keys** that are clearly fake
4. Review warnings in logs for unintended credential exposure
