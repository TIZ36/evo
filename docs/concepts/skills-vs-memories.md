# Skills vs Memories

evo manages two distinct asset classes: **memories** (declarative facts) and **skills** (procedural SOPs). Understanding when to use each helps evo learn more effectively.

## Memories

Memories are declarative blocks — facts, preferences, constraints, and simple procedures. They are stored in a single table and recalled inline as part of the context.

### When evo creates a memory

- A fact was confirmed across multiple turns
- A preference or constraint was established
- A simple convention was discovered

### Memory recall

Memories are injected directly into context:

```
# Relevant memory

- [fact] **Project uses TypeScript**: All source files are .ts, compiled via tsc
- [preference] **Prefer pnpm**: Use pnpm instead of npm for package management
- [constraint] **No console.log in production**: Use the logger service instead
```

## Skills

Skills are procedural SOPs — reusable multi-step operations worth materializing as file-backed assets. They are stored separately and recalled as **catalog entries**, not inline content.

### When evo creates a skill

A skill is rarer than a memory. evo creates one when a batch reveals a procedure that:

1. Spans multiple steps or tools
2. Would benefit from explicit documentation
3. Is likely to recur in future work

### Skill structure

Every skill has five sections:

| Section | Description |
| --- | --- |
| **Purpose** | What this skill accomplishes (1-2 sentences) |
| **Trigger** | When to use it, including "don't use when..." lines |
| **Steps** | Anchored step-by-step instructions (numbered, concrete) |
| **Check** | Falsifiable verification — how to know it worked |
| **Reflex** | (Optional) Automatic response pattern |

### Viewing skills in the Memory panel

The Memory panel (Settings → Memory) includes a **Skills** tab that lists all skills with:

- **Name**: the kebab-case skill identifier
- **Trigger**: a one-line summary of when to use the skill
- **Uses**: how many times the skill has been applied
- **Promoted/Dormant**: status badges for mature or unused skills
- **Path**: the SKILL.md file location

This lets you browse the skill catalog without inspecting the filesystem.

## Skill recall

Skills are recalled as catalog entries, not the full body:

```
# Available skills (Read SKILL.md on use)

- **deploy-workflow**: When ready to deploy → `.paper/agents/skills/deploy-workflow/SKILL.md`
- **git-commit-workflow**: When committing staged changes → `.paper/agents/skills/git-commit-workflow/SKILL.md`
```

The agent should Read the SKILL.md file when it needs to execute that skill. This keeps the injected context small.

## File structure

evo materializes skills to disk under the project's cwd:

```
.paper/
├── AGENT_MEMORY.md          # Catalog with skill entries
└── agents/
    └── skills/
        └── deploy-workflow/
            ├── SKILL.md     # The skill itself
            └── .memory.md   # Lessons learned (optional)
```

### SKILL.md

The skill body rendered as markdown:

```markdown
# Deploy Workflow

## Purpose

Deploy application to production safely.

## When to use

- When all tests pass and changes are reviewed
- Don't use when: hotfixing a critical bug (use emergency deploy instead)

## Steps

1. Run the full test suite
2. Build the production bundle
3. Deploy to staging and verify
4. Deploy to production
5. Monitor logs for errors

## Verification

Application is running and responding to health checks.

## Reflex

Always announce deployments in the team channel.
```

### .memory.md

Lessons learned from using the skill:

```markdown
# Lessons: Deploy Workflow

- 2024-03-15: Always check disk space before deploying
- 2024-03-20: Run database migrations before starting new pods
```

## Imported vs evo-owned

### Human-written skills

Skills in `.claude/skills/`, `.codex/skills/`, etc. are imported as workspace memories with `kind: skill`. They are never evicted by evo.

### Evo-written skills

Skills in `.paper/agents/skills/` are managed by evo through the skills table. They can be updated when evo learns better approaches.

| Asset | Location | Evictable |
| --- | --- | --- |
| Human skill | `.claude/skills/*/SKILL.md` | No |
| Evo skill | `.paper/agents/skills/*/SKILL.md` | Yes (by evo) |
| Lesson file | `.paper/agents/skills/*/.memory.md` | Yes (by evo) |

## Usage tracking

When an agent uses a skill:

1. The usage count increments
2. A lesson may be appended to `.memory.md`
3. Higher-use skills rank higher in recall

Call `useSkill(scope, name, lesson?)` to track usage programmatically.

## Skill polish

Skills improve over time through **polish** — folding accumulated lessons into the skill body. Polish happens when:

- A skill has accumulated 3+ unfolded lessons
- A form check suggests the skill needs improvement

### Polish guards

To prevent runaway growth, polish is rejected when:

- Step count grows by more than 50%
- Absolute paths are introduced (use `~/` or relative paths)
- Reflex section exceeds 500 characters

If a polished draft fails these guards, the original SKILL.md is preserved.

### L1 form check

Every skill must pass the L1 form check:

| Check | Requirement |
| --- | --- |
| Name | kebab-case (`deploy-workflow`, not `DeployWorkflow`) |
| Purpose | 10-500 characters, clear objective |
| Trigger | 10+ characters, includes "don't use when..." |
| Steps | At least 2 numbered/bulleted items |
| Check | 10+ characters, falsifiable verification |
| Reflex | Optional, max 500 characters |

## Dormancy

Skills that go unused become **dormant**:

- **Threshold**: 0 uses and 21+ days since last update
- **Dormant skills**: Still listed in catalog, but without description
- **Wake on use**: Using a dormant skill wakes it (increments usage, clears dormancy)
- **No capacity eviction**: Skills are never deleted due to store cap (unlike memories)

Dormancy keeps rarely-used skills available without cluttering active recall.

## Configuration

Skills follow the same recall limits as memories:

| Variable | Default | Description |
| --- | --- | --- |
| `EVO_HOOK_RECALL_LIMIT` | 40 | Max items (memories + skills) to recall |
| `EVO_HOOK_MAX_CHARS` | 6000 | Max context characters |

Skills appear in the catalog section after memories, respecting the overall limits.
