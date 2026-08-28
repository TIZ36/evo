# Requirements

## Runtime

- **Node.js 22.19 or newer** — evo uses the built-in `node:sqlite` module for local storage

## Host Requirements

Depending on which host you use, you'll need:

### DeepSeek Harness

- DeepSeek Harness `0.1.x`
- A configured Harness LLM provider and model for reflection and consolidation

The Cordis plugin and core library work without Harness; the Harness-specific pieces are optional peer dependencies.

### Claude Code

- Claude Code CLI or desktop app
- No additional API keys required — evo uses the CLI's own credentials for reflection

### Codex

- Codex CLI
- No additional API keys required — evo uses `codex exec` with your existing configuration

## Package Manager

The project uses pnpm, but evo can be installed with any package manager:

```bash
pnpm add evo
# or
npm install evo
# or
yarn add evo
```

## Platform Support

evo runs on macOS, Linux, and Windows. The SQLite database location follows platform conventions:

| Platform | Default Path |
| --- | --- |
| macOS | `~/Library/Application Support/evo/memory.db` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/evo/memory.db` |
| Windows | `%APPDATA%\evo\memory.db` |
