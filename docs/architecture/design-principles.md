# Design Principles

This document describes the core design principles of evo as an open-source memory system.

## Purpose

evo is an independent agent memory and evolution component. It distills memories and reusable skills from conversation turns, providing retrieval, injection, consolidation, and deletion capabilities to different agent runtimes.

## Core Principles

### 1. Single Source of Truth

All configuration, credentials, memories, and skills have their authoritative state in local SQLite storage. Files on the filesystem (`.md`, `.json`) are **regenerable materialized views** — delete them and they'll be rewritten. No secrets are ever written to files.

This ensures:
- Auditability
- Safe migration
- No split-brain between multiple stores

### 2. Interface-Implementation Separation

Core logic depends only on abstract interfaces, never directly on SQLite, Markdown, or specific hosts:

| Interface | Responsibility |
| --- | --- |
| `MemoryStore` | CRUD and scope-based replacement |
| `MemoryMaterializer` | Output to Markdown, JSON, or runtime context |
| `ModelRunner` | Execute reflection and consolidation model calls |
| `MemoryEventSink` | Audit events and state changes |

SQLite, Markdown, Cordis, and DeepSeek are adapters. Replacing storage, model, or host shouldn't require rewriting core business logic.

### 3. Provider-Neutral

Assets are delivered to any CLI via files (`AGENT_MEMORY.md`, `SKILL.md`) plus injection guidance. Claude uses system prompt append; other providers use prompt prefixes. evo doesn't depend on any single provider's native memory mechanism.

### 4. Out of the Box, Yet Replaceable

The project must work immediately after installation: default data directory, default SQLite storage, default materialization strategy.

At the same time, everything is replaceable:
- Data directory via config or environment variable
- Database file path
- Materialization target

"Out of the box" and "replaceable" coexist: defaults serve most users, explicit configuration allows alternatives without changing the Memory API.

### 5. Truth and Materialization

Structured storage is the source of truth. Markdown, skill files, and prompt fragments are materialized views.

Materializers must be:
- Re-runnable (idempotent)
- Testable
- Clear about version and conflict handling

External hosts shouldn't bypass core storage by modifying materialized files directly.

### 6. Structured Scopes

Scopes use structured identifiers, not magic string sentinels:

- `global` — applies everywhere
- `user` — user-specific
- `project` — tied to working directory
- `session` — current conversation
- `conversation` — finer-grained if needed

Adapters map host contexts to these scopes.

## Evolution Sequence

The implementation follows this order:

1. DeepSeek Harness memory loop working
2. Additional host adapters (Claude Code, Codex)
3. No adapter pollutes the core protocol

## Reference

For the full theoretical framework including CLS (Complementary Learning Systems) mapping and comparison with MUSE-Autoskill, Voyager, MemGPT, and other systems, see the internal design document at `docs/reference/evo-reference.md`.
