# Retention

evo uses **usage-aware retention** to manage store capacity. Frequently-used memories are protected while rarely-used ones may be evicted when the store exceeds its capacity.

## Usage tracking

### Automatic tracking

Usage counts increment automatically when:

1. Memories are recalled into context
2. The `trackRecall` method is called explicitly

### Usage in scoring

Higher usage count = higher eviction score = less likely to evict:

```typescript
score += usageCount * 10
```

## Eviction scoring

When the store exceeds `maxMemories`, evo scores each memory and evicts the lowest-scored ones.

### Score factors

| Factor | Weight | Description |
| --- | --- | --- |
| Usage count | +10 per use | Frequently used = valuable |
| Recency | +0 to +30 | More recent = more relevant |
| Kind | +5 to +20 | Constraints/facts > preferences > procedures |
| Confidence | +0 to +10 | Higher confidence = more reliable |

### Newborn grace

Memories created within `newbornGraceDays` are **protected** from eviction (score = Infinity). This prevents evicting information before it has a chance to prove useful.

### Imported protection

**Workspace-imported memories are never evicted.** Only memories with `source.runtime === 'evo'` (or the legacy `'evo-memory'`) are candidates for eviction.

This ensures that human-written files like `.claude/memories/*.md` are always preserved.

## Capacity enforcement

### Automatic enforcement

Capacity is enforced during slow-path processing (after reflection batches):

```typescript
const evicted = await service.enforceCapacity(scope)
```

### Manual enforcement

You can trigger enforcement manually:

```typescript
const evicted = await service.enforceCapacity(scope)
// evicted: MemoryItem[] — the items that were removed
```

### Eviction strategy

Eviction is **demotion** — items are deleted, not archived. The assumption is that evicted information was either:

1. Obsolete (superseded by newer facts)
2. Low-value (rarely used, low confidence)
3. Recoverable (can be re-learned if needed)

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `maxMemories` | 200 | Maximum memories per scope before eviction |
| `newbornGraceDays` | 3 | Days before new memories can be evicted |

### Environment variables

The **recall limit** (`EVO_HOOK_RECALL_LIMIT`) controls how many items are injected into context — it is NOT the same as `maxMemories`. The store can hold more than the recall limit; recall just samples the top-ranked items.

| Variable | Default | Description |
| --- | --- | --- |
| `EVO_HOOK_RECALL_LIMIT` | 40 | Max items to inject into context |
| `EVO_HOOK_MAX_CHARS` | 6000 | Max context characters |

## Skill retention

**Skills are never capacity-evicted.** They follow different retention rules:

| Asset | Capacity eviction | Dormancy | Polish |
| --- | --- | --- | --- |
| Memory | Yes | No | No |
| Skill | No | Yes (21 days unused) | Yes (lesson folding) |

See [Skills vs Memories](skills-vs-memories.md) for dormancy and polish details.

## Debugging

To understand why a memory was evicted, check its score factors:

```typescript
import { evictionScore } from 'evo/core/retention.js'

const score = evictionScore(memory, retentionConfig, Date.now())
// Lower score = more likely to evict
```

Protected memories (newborn or non-evo source) return `Infinity`.
