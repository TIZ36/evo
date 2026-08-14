# evo-memory v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, open-source-ready Cordis memory plugin that persists structured memories in SQLite and integrates with DeepSeek Harness for prompt-time recall and completed-turn reflection.

**Architecture:** The core owns provider-neutral memory types and workflows over injected `MemoryStore`, `ModelRunner`, and event interfaces. SQLite is the default infrastructure implementation. A Cordis service exposes the core, while a DeepSeek adapter consumes Harness session events and LLM services without introducing Paper dependencies.

**Tech Stack:** TypeScript, Node.js 22+, `@deepseek-ai/cordis`, DeepSeek Harness session/LLM contracts, `node:sqlite`, Zod, Vitest, tsdown.

---

### Task 1: Package scaffold and public contracts

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `.gitignore`, `LICENSE`
- Create: `src/core/types.ts`, `src/core/contracts.ts`, `src/index.ts`
- Test: `tests/core/contracts.spec.ts`

- [ ] Write a failing contract test for scope keys, memory validation, and public exports.
- [ ] Run `npm test -- tests/core/contracts.spec.ts` and confirm failure due to missing modules.
- [ ] Define the minimal `MemoryItem`, `MemoryScope`, `MemoryQuery`, `Turn`, `MemoryDelta`, `MemoryStore`, `ModelRunner`, `MemoryMaterializer`, and `MemoryEventSink` contracts.
- [ ] Run the focused test and confirm it passes.

### Task 2: SQLite store

**Files:**
- Create: `src/storage/sqlite-store.ts`, `src/storage/schema.ts`, `src/config/paths.ts`
- Test: `tests/storage/sqlite-store.spec.ts`, `tests/config/paths.spec.ts`

- [ ] Write failing tests for platform default paths, explicit config precedence, CRUD, scope filtering, text search, usage ordering, and atomic scope replacement.
- [ ] Run the focused tests and confirm failures due to missing implementations.
- [ ] Implement versioned SQLite schema initialization and the `MemoryStore` interface.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Core memory workflows

**Files:**
- Create: `src/core/evo-memory.ts`, `src/core/json-model.ts`, `src/core/prompt.ts`
- Test: `tests/core/evo-memory.spec.ts`, `tests/core/json-model.spec.ts`

- [ ] Write failing tests for remember/recall/forget, deterministic prompt rendering, model JSON extraction, reflection upserts, and safe consolidation replacement.
- [ ] Run the focused tests and confirm failures due to missing implementations.
- [ ] Implement `EvoMemoryService`, bounded prompt rendering, JSON response parsing, reflection, and consolidation with empty-result protection.
- [ ] Run the focused tests and confirm they pass.

### Task 4: Cordis plugin

**Files:**
- Create: `src/cordis/index.ts`, `src/cordis/service.ts`, `src/cordis/config.ts`
- Test: `tests/cordis/plugin.spec.ts`

- [ ] Write a failing test that loads the plugin in a real Cordis `Context`, resolves `ctx.evoMemory`, and disposes the SQLite store with the plugin fiber.
- [ ] Run the focused test and confirm failure due to the missing service/plugin.
- [ ] Implement the Cordis `Service` registration, configuration schema, default store construction, and cleanup.
- [ ] Run the focused test and confirm it passes.

### Task 5: DeepSeek Harness adapter

**Files:**
- Create: `src/deepseek/index.ts`, `src/deepseek/events.ts`, `src/deepseek/adapter.ts`
- Test: `tests/deepseek/adapter.spec.ts`, `tests/deepseek/loader.spec.ts`

- [ ] Write failing tests using real Harness session event shapes for completed-turn extraction, prompt context recall, completed-turn reflection, ignored interrupted turns, and loader composition.
- [ ] Run the focused tests and confirm failures due to missing adapter code.
- [ ] Implement a Harness-native Cordis plugin that injects the session, LLM, and evo-memory services; register prompt-time context and turn-end observation through published extension points.
- [ ] Run the focused tests and confirm they pass.

### Task 6: Documentation and release verification

**Files:**
- Create: `README.md`, `examples/cordis.yml`
- Modify: `package.json`

- [ ] Document default data paths, all configuration options, the Cordis YAML entry, the memory API, privacy behavior, and current limitations.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm pack --dry-run`.
- [ ] Inspect package contents and confirm Paper files, local databases, fixtures, and development-only documents are excluded.
