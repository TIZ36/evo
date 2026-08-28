<div align="center">

# evo

**Evolving memory for agents — recall before the model thinks, reflect after it answers.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-5fa04e.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](#status)

</div>

evo is a provider-neutral memory service that gives AI coding agents durable, cross-session memory. It recalls relevant knowledge into the system prompt before a model step, and reflects completed turns into structured memory afterwards — so an agent keeps what it learned across sessions without you writing it down.

## Why evo?

Local CLI agents (Claude Code, Codex, DeepSeek Harness) are stateless by default: each session starts from zero. User preferences, project conventions, pitfalls stepped into three times — all evaporate when the session ends.

evo solves this with a **recall + reflect loop**:

- **Recall**: Before each prompt, assemble relevant memories into the agent's context
- **Reflect**: After each successful turn, distill the conversation into structured memory items

The result: your agent becomes an experienced colleague who remembers the project.

## Documentation

📖 **Full documentation**: https://evo-5.gitbook.io/evo/

| Section | Description |
| --- | --- |
| [GitBook Docs](https://evo-5.gitbook.io/evo/) | Primary documentation site |
| [Getting Started](docs/getting-started/requirements.md) | Requirements and installation |
| [Host Integrations](docs/hosts/deepseek-harness.md) | DeepSeek Harness, Claude Code, Codex |
| [Concepts](docs/concepts/how-it-works.md) | How recall + reflect works |
| [Configuration](docs/configuration/environment-variables.md) | All settings and environment variables |
| [API Reference](docs/api/http-api.md) | HTTP and service APIs |
| [Development](docs/development/contributing.md) | Contributing guide |

## Quick Start

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

## Key Features

- **Structured memory**: Every item has a scope, kind (fact, constraint, procedure, skill…), tags, and source
- **First-class skills**: Procedural SOPs separate from declarative memories, with lessons learned tracking and a dedicated Skills tab in the Memory panel
- **Batch distillation**: Turns are collected and distilled in batches for better memory quality
- **Local by default**: SQLite storage via Node's built-in `node:sqlite` — nothing leaves the machine except reflection model calls
- **Workspace import**: Existing `CLAUDE.md`, `AGENTS.md`, `.codex/`, and similar files are imported automatically
- **Provider-neutral**: Works with DeepSeek Harness, Claude Code, and Codex through adapters

## Status

evo is currently **alpha (0.3.x)**. The core loop is stable and used daily, but APIs may change.

### Current Limitations

- Recall uses deterministic SQLite filtering and ranking, without embeddings
- Consolidation runs automatically on the slow path (floor 24h / 72h converged, or large replay buffer); call `consolidate()` or use the web panel for manual runs
- `node:sqlite` is still marked experimental by current Node releases (it ships with Node 22+)

## Development

```bash
pnpm install
pnpm check          # test + typecheck + build + rule scan
```

See [Contributing](docs/development/contributing.md) for the full development guide.

### Project Rule

This is a personal open-source project. Company identity and sensitive information must never appear in the repository. Team attribution is "Paper team" only. See [Project Rules](docs/development/project-rules.md) for details.

## License

[MIT](LICENSE) © TIZ36
