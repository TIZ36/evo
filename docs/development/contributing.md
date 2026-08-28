# Contributing

Contributions are welcome! This guide covers the development workflow and requirements.

## Getting Started

```bash
# Clone the repository
git clone https://github.com/TIZ36/evo.git
cd evo

# Install dependencies
pnpm install

# Run the full check suite
pnpm check
```

## Development Commands

| Command | Description |
| --- | --- |
| `pnpm test` | Run tests with Vitest |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm build` | Build all packages and plugin bundle |
| `pnpm check` | Full verification: test + typecheck + build + rule scan |
| `pnpm rule:scan` | Scan for sensitive information violations |

## Before Opening a PR

1. **Run the full check**: `pnpm check` must pass
2. **Keep changes scoped**: One topic per PR
3. **Follow project rules**: See [Project Rules](project-rules.md)

## Project Structure

```
evo/
├── src/
│   ├── core/           # Memory domain model and interfaces
│   ├── cordis/         # Cordis plugin
│   ├── deepseek/       # DeepSeek Harness adapter
│   ├── hook/           # Claude Code / Codex hook
│   └── client/         # Web panel (plain JS)
├── plugin/             # Pre-built plugin bundle for marketplaces
├── tests/              # Test suites
├── docs/               # This documentation
├── examples/           # Configuration examples
└── scripts/            # Build and maintenance scripts
```

## Plugin Bundle

The `plugin/` directory contains a pre-built bundle committed to the repository:

- Both Claude Code and Codex install plugins by copying the repo
- They run no build step and don't restore pnpm dependencies
- So the plugin must be runnable exactly as checked in

`pnpm build` regenerates the bundle, and `pnpm test` fails if it drifts from source.

## Design Documents

- **Design authority**: [`docs/reference/evo-reference.md`](../architecture/design-principles.md) (Chinese, internal reference)
- **Storage decisions**: [`docs/storage-architecture.md`](../architecture/storage-architecture.md)
- **Open-source principles**: [`docs/design-principles.md`](../architecture/design-principles.md)

## Code Style

- TypeScript with strict mode
- ESM modules (`"type": "module"`)
- No unnecessary comments — code should be self-explanatory
- Interfaces over concrete types for extensibility

## Testing

Tests use Vitest and cover:

- Core memory operations
- Reflection and consolidation
- Hook behavior
- Iron rule enforcement (no sensitive data)

Run specific tests:

```bash
pnpm test -- tests/core/
pnpm test -- --grep "reflection"
```

## Questions?

Open an issue on GitHub for questions or discussions before starting large changes.
