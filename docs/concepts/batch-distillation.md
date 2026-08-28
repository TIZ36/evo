# Batch Distillation

evo doesn't reflect after every single turn. Instead, it queues turns and distills them in batches. This produces better memories with fewer model calls.

## Why Batching?

A single turn is thin material. What earns a place in memory — the pitfall stepped into three times, the convention confirmed repeatedly — only becomes visible across multiple turns.

Reflecting per turn:
- Pays a model call to potentially miss patterns
- Produces isolated, less meaningful memories
- Costs more API credits

Batching:
- Captures cross-turn patterns
- Produces richer, more useful memories
- Uses fewer model calls

## Batch Triggers

A batch is distilled when any threshold is reached:

| Condition | Default | Variable |
| --- | --- | --- |
| Turn count | 10 turns | `EVO_HOOK_BATCH_TURNS` |
| Character count | 12,000 chars | `EVO_HOOK_BATCH_CHARS` |
| Idle time | 5 minutes | `EVO_HOOK_BATCH_IDLE_MS` |

### Turn Count

Once the batch holds `EVO_HOOK_BATCH_TURNS` turns, it's distilled. Set to `1` to restore turn-by-turn reflection.

### Character Count

When accumulated conversation reaches `EVO_HOOK_BATCH_CHARS` characters, the batch is distilled even if the turn count hasn't been reached. This handles long conversations.

### Idle Time

After `EVO_HOOK_BATCH_IDLE_MS` milliseconds of inactivity, the next hook event settles any waiting batch.

Note: Hooks are short-lived processes with no persistent timers. The idle condition is **checked**, not fired — later hook events (session start, prompt submit) settle the deadline.

## How It Works

### On `Stop` (Turn Complete)

1. The completed turn is queued into the project's batch
2. Turn content is trimmed to fit budget:
   - User message: `EVO_HOOK_TURN_USER_CHARS` (default 400)
   - Assistant message: `EVO_HOOK_TURN_ASSISTANT_CHARS` (default 600)
   - Tool names: `EVO_HOOK_TURN_TOOLS` (default 20)
3. If any threshold is met, the batch is distilled immediately
4. Otherwise, the batch waits

### On `SessionStart` or `UserPromptSubmit`

1. Check if the project's batch has exceeded idle time
2. If so, distill it before proceeding
3. Then recall and inject memory as normal

### Background Processing

Reflection runs in a **detached background process** — the hook returns immediately so your session is never blocked. The child runs with `EVO_HOOK_DISABLE=1` to prevent recursion.

Results appear on your next prompt: `evo · remembered 2, updated 1`

## Batch Content

The reflector receives:
- Trimmed conversation from each turn in the batch
- Current memories in scope (so it knows what already exists)
- Limits on how many items to return

This context allows it to:
- Recognize patterns across turns
- Update existing memories instead of duplicating
- Identify memories that the batch disproved (for eviction)

## Configuration

Set via environment variables:

```bash
export EVO_HOOK_BATCH_TURNS=5        # smaller batches
export EVO_HOOK_BATCH_CHARS=8000     # trigger earlier on long turns
export EVO_HOOK_BATCH_IDLE_MS=60000  # 1 minute idle timeout
```

Set `EVO_HOOK_BATCH_TURNS=1` to disable batching entirely and reflect after every turn.
