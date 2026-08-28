# Installation

## From npm

```bash
pnpm add @tiz36/evo
```

## From a Local Checkout

Before publication, install from a local directory:

```bash
pnpm add /absolute/path/to/evo
```

## Quick Start by Host

Choose your integration:

- **[DeepSeek Harness](../hosts/deepseek-harness.md)** — Full plugin with web panel
- **[Claude Code](../hosts/claude-code.md)** — Hook-based integration via marketplace or installer
- **[Codex](../hosts/codex.md)** — Hook-based integration via marketplace or installer

Each host integration has its own installation method. The quickest path for each:

### DeepSeek Harness

```bash
./install_evo_dsps.sh
```

### Claude Code

```bash
/plugin marketplace add TIZ36/evo
/plugin install evo
```

### Codex

```bash
codex plugin marketplace add TIZ36/evo
codex plugin add evo@evo
```

## Verifying Installation

After installation, evo works automatically:

1. Start a session in any project directory
2. Complete a turn with the agent
3. On your next prompt, you'll see a system message like `evo · remembered 2, updated 1`

The memory panel (DeepSeek Harness only) or CLI logs will show what evo learned from the conversation.
