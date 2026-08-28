# Skill Promotion

Skills in evo progress through a maturity lifecycle. When a skill has been used enough times, it becomes **promoted** — marked as mature and established.

## Promotion Threshold

Skills are promoted after reaching **3 uses** (`SKILL_PROMOTION_THRESHOLD`).

| Uses | Status |
|------|--------|
| 0-2 | New/untested |
| 3+ | Promoted (mature) |

## What Promotion Means

Promoted skills receive preferential treatment:

1. **Catalog ordering**: Promoted skills appear first in listings
2. **Context rendering**: Marked with ★ in skill context
3. **Dormancy immunity**: Promoted skills are treated as established for dormancy decisions
4. **No capacity eviction**: Skills are never evicted for capacity (unlike memories)

## Automatic Promotion

Promotion happens automatically when `incrementUsage` is called:

```typescript
await skillStore.incrementUsage(scope, 'git-commit-workflow')
// After 3rd call: skill.promoted = true
```

This is typically triggered by `useSkill`:

```typescript
await evo.useSkill(scope, 'git-commit-workflow', 'Added signed commits')
```

## Querying Promoted Skills

The skill listing API sorts promoted skills first:

```bash
GET /evo/skills?scopeType=project&scopeId=/repo
```

Response:
```json
{
  "skills": [
    { "name": "git-commit", "promoted": true, "usageCount": 5 },
    { "name": "deploy-workflow", "promoted": false, "usageCount": 1 }
  ]
}
```

## Context Display

In recalled context, promoted skills show with a marker:

```
# Available skills (Read SKILL.md on use)
- **git-commit** ★: When committing code → `.paper/agents/skills/git-commit`
- **deploy-workflow**: When deploying → `.paper/agents/skills/deploy-workflow`
```

## Trust Model

Skills are **trusted on first distill**. Unlike memories which may be consolidated or evicted, skills represent procedural knowledge that has been explicitly identified as reusable.

Promotion adds an additional signal: this skill has proven useful in practice, not just in theory.

## No Capacity Eviction

Unlike memories, skills are **never evicted for capacity**. They may become dormant (hidden from active recall) but are never deleted automatically. This ensures procedural knowledge is preserved even if not recently used.
