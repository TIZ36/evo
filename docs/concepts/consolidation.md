# Consolidation

evo uses a **slow-path consolidation** process to keep memories organized and efficient. Unlike fast-path reflection (which happens after each batch), consolidation rewrites the entire memory store to merge duplicates, remove obsolete facts, and maintain coherence.

## How it works

### Replay buffer

Every batch reflection appends its distilled memories to a **replay buffer**. This preserves the raw evidence for consolidation:

1. Turn completes → reflection distills memories
2. Memories saved to store AND appended to replay buffer
3. Replay entries marked as unconsumed

### Consolidation trigger

Consolidation runs automatically when triggered by hook events (SessionStart, UserPromptSubmit). The check considers:

| Factor | Threshold |
| --- | --- |
| Replay buffer size | ≥ 10 unconsumed entries |
| Time since last consolidate | ≥ 24 hours (base) |
| Converged state | ≥ 72 hours minimum |

### Snapshot safety

Before the model runs, consolidation takes a **snapshot** of current memories. If the model returns an empty or broken result, the snapshot is restored. This prevents accidental data loss.

### Near-duplicate detection

Consolidation uses **Jaccard similarity** (word overlap ratio) to hint at near-duplicates. This is cheap, requires no embeddings, and helps the model merge redundant entries:

```
Potential duplicates to merge:
- "Use pnpm" and "Package manager preference"
```

### Convergence

If the memory digest is unchanged after consolidation, the state is marked **converged**:

- Converged: wait longer before next consolidate (multiplier ×3, up to ×9)
- Not converged: reset to base interval

This avoids churning on stable memory sets while keeping active projects responsive.

## Manual consolidation

You can trigger consolidation manually via the service API:

```typescript
await service.consolidate(scope)
```

This bypasses the schedule check but still uses snapshots and safety guards.

## Auto-consolidation check

To check if consolidation should run (without actually running it):

```typescript
const check = await service.shouldAutoConsolidate(scope)
// check.shouldConsolidate: boolean
// check.reason: 'backlog' | 'replay' | 'schedule' | 'none'
// check.hoursSinceLastConsolidate: number
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `retention.consolidateIntervalHours` | 24 | Base hours between consolidates |
| `retention.convergedMinIntervalHours` | 72 | Minimum hours when converged |

## State tracking

Consolidation state is stored per-scope in the `consolidation_state` table:

| Field | Description |
| --- | --- |
| `last_consolidate_at` | Timestamp of last consolidation |
| `last_digest` | Hash of memory titles+content |
| `converged` | Whether last run showed no changes |
| `convergence_multiplier` | Wait multiplier (1.0 to 9.0) |
