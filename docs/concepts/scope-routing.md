# Scope Routing

When evo distills memories and skills from conversations, it must decide where to store them. The scope routing system ensures content lands at the appropriate level: project-specific or global.

## Default Routing

**When unsure, evo defaults to project scope** (the current working directory). This prevents project-specific facts from polluting the global namespace.

Only truly universal facts that apply across ALL projects should be stored at global scope.

## Deduplication Across Scopes

Before creating a project-scoped memory or skill, evo checks if the same title/name already exists at global scope:

- If a **global memory** with the same title exists → skip creating the project duplicate
- If a **global skill** with the same name exists → skip creating the project duplicate

This prevents redundant storage and ensures the global version takes precedence.

## How It Works

During `reflectBatch`:

1. evo queries both the current scope AND global scope for existing memories/skills
2. The reflection prompt is augmented with:
   - Titles already stored in the current scope
   - Titles already stored at global scope (with instructions not to duplicate)
3. The model is guided to prefer project scope unless the fact is clearly universal
4. Post-reflection, any candidates matching global titles are filtered out

## Prompt Guidance

The reflector receives explicit instructions:

> When unsure about scope, default to project scope (the current working directory). Only use global scope for truly universal facts that apply across ALL projects. Skip creating a project-scoped memory if the same title already exists at global scope — the global one takes precedence.

## Example Behavior

| Scenario | Outcome |
|----------|---------|
| User sets language preference at global scope | Global memory "Language" created |
| User sets language preference at project scope, global exists | Project memory skipped |
| User learns a project-specific workflow | Project skill created |
| User learns a universal command pattern | Global skill (if explicit), else project |

## Best Practices

1. **Be explicit** when storing global facts — mark them as universal
2. **Let project scope be the default** for most knowledge
3. Global memories should be rare and truly universal
4. Review the scope tree (`GET /evo/scopes`) to audit distribution
