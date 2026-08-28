# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-28

### Changed

- npm package name is now `@tiz36/evo` because the unscoped name `evo` was already taken on npm.

### Added

- First-class skills: procedural SOPs distinct from declarative memories, with 5-section format (Goal, Trigger, Steps, Verification, Lessons), SKILL.md catalog, and lessons learned tracking.
- Slow path consolidation: replay-buffered consolidate with usage-aware retention, polish/L1/dormancy tiers, and eval harness.
- Credential scan before write: prevents accidental leakage of sensitive data to memory store.
- Root vs project scope routing: memories are automatically routed to the appropriate scope.
- Skill promotion at uses >= 3: frequently-used procedures are promoted to first-class skills.
- HTTP GET `/evo/skills` and `/evo/backlog` endpoints for external integrations.
- DSH Memory panel Skills tab and backlog chip for managing skills in the web UI.
- GitBook documentation site at https://evo-5.gitbook.io/evo/.

### Fixed

- GitGuardian false positives from test fixtures (runtime-assembled synthetic credentials).

### Docs

- GitBook structure published at https://evo-5.gitbook.io/evo/.

## [0.2.0] - 2026-07-01

Initial public release.

### Added

- Core recall + reflect loop: recall relevant memories before model step, reflect completed turns into structured memory.
- SQLite storage via Node's built-in `node:sqlite`.
- DeepSeek Harness (DSH), Claude Code, and Codex host integrations.
- Structured memory items with scope, kind, tags, and source tracing.
- Workspace import for existing CLAUDE.md, AGENTS.md, .codex/ files.
- Batch distillation for better memory quality.

---

Attribution: Paper team.
