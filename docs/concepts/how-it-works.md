# How It Works

evo maintains a **recall + reflect loop** that runs automatically during your agent sessions.

## The Loop

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐           │
│   │ RECALL  │───▶│  TURN   │───▶│ REFLECT │───┐       │
│   └─────────┘    └─────────┘    └─────────┘   │       │
│        ▲                                       │       │
│        │                                       │       │
│        │         ┌─────────────┐               │       │
│        └─────────│   MEMORY    │◀──────────────┘       │
│                  │    STORE    │                       │
│                  └─────────────┘                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1. Recall

Before each prompt, evo queries the memory store for relevant items:

- **Global memories** — facts and constraints that apply everywhere
- **Project memories** — knowledge specific to the current working directory
- **Session memories** — context from the current conversation

These memories are assembled into the system prompt or injected as context, depending on the host.

### 2. Turn

The agent processes your prompt with the recalled context available. evo observes but doesn't interfere.

### 3. Reflect

After a successful turn completes, evo distills the conversation into structured memory items:

- What facts were established?
- What constraints were confirmed?
- What procedures were followed?
- What skills were demonstrated?

Failed, aborted, or interrupted turns are never reflected — only successful completions produce memories.

## Structured Memory

Every memory item has:

| Field | Description |
| --- | --- |
| `scope` | Where it applies: global, project, session, etc. |
| `kind` | What type: fact, constraint, procedure, skill |
| `title` | Short identifier |
| `content` | The actual knowledge |
| `tags` | Categorization and search terms |
| `source` | Which session and turn it came from |

This structure enables precise recall and prevents the memory store from becoming a disorganized scratchpad.

## Batch Distillation

Reflection doesn't happen after every single turn. Instead, turns are queued and distilled in batches. This approach:

- **Improves quality**: Patterns only become visible across multiple turns
- **Reduces costs**: Fewer model calls for reflection
- **Catches relationships**: The pitfall stepped into three times, the convention confirmed repeatedly

See [Batch Distillation](batch-distillation.md) for details on thresholds and configuration.

## What Gets Remembered

The reflection prompt explicitly instructs the model to capture:

- **Facts**: Established truths about the project or domain
- **Constraints**: Rules, requirements, red lines
- **Procedures**: How to do something, step by step
- **Skills**: Reusable capabilities with clear triggers

And to reject:

- Secrets, credentials, API keys
- Raw logs or temporary data
- Guesses or uncertain claims
- Transient task state

## What Gets Forgotten

evo includes automatic eviction:

- **Semantic eviction**: When new information contradicts old, the old is removed
- **Capacity limits**: Each scope has a maximum item count (default 40)
- **Staleness**: Oldest, least-used items are candidates for removal

The latest information always wins — this is a core design principle.
