# evo

**Evolving memory for agents — recall before the model thinks, reflect after it answers.**

evo is a provider-neutral memory service that gives AI coding agents durable, cross-session memory. It recalls relevant knowledge into the system prompt before a model step, and reflects completed turns into structured memory afterwards — so an agent keeps what it learned across sessions without you writing it down.

## Why evo?

Local CLI agents (Claude Code, Codex, DeepSeek Harness) are stateless by default: each session starts from zero. User preferences, project conventions, pitfalls stepped into three times — all evaporate when the session ends.

evo solves this by maintaining a **recall + reflect loop**:

- **Recall**: Before each prompt, evo assembles relevant memories into the agent's context
- **Reflect**: After each successful turn, evo distills the conversation into structured memory items

The result: your agent becomes an experienced colleague who remembers the project, not a stranger who needs the same explanations every time.

## Key Features

- **Structured memory**: Every item has a scope, kind (fact, constraint, procedure, skill…), tags, and source tracing back to the session and turn it came from
- **Local by default**: SQLite storage via Node's built-in `node:sqlite` — nothing leaves the machine except reflection model calls
- **Workspace import**: Existing `CLAUDE.md`, `AGENTS.md`, `.codex/`, and similar files are imported as project-scoped memory on first use
- **Provider-neutral**: Works with DeepSeek Harness, Claude Code, and Codex through adapters
- **Batch distillation**: Turns are collected and distilled in batches for better memory quality and fewer model calls

## Supported Hosts

| Host | Integration |
| --- | --- |
| [DeepSeek Harness](hosts/deepseek-harness.md) | Cordis plugin with web panel |
| [Claude Code](hosts/claude-code.md) | Hook plugin via CLI or marketplace |
| [Codex](hosts/codex.md) | Hook plugin via CLI or marketplace |

## Quick Links

- [Getting Started](getting-started/requirements.md) — Requirements and installation
- [How It Works](concepts/how-it-works.md) — The recall + reflect loop explained
- [Configuration](configuration/environment-variables.md) — All settings and environment variables
- [HTTP API](api/http-api.md) — REST endpoints for external integrations

## Status

evo is currently **alpha (0.2.x)**. The core loop is stable and used daily, but APIs may change. The project is MIT-licensed.

## Attribution

Developed by the Paper team.
