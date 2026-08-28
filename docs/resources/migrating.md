# Migrating from evo-memory

If you used the previous package name `evo-memory`, migration is automatic. This page documents the compatibility surface.

## What Changed

| Component | Old | New |
| --- | --- | --- |
| Package name | `evo-memory` | `evo` |
| Plugin rows | `evo-memory/cordis`, etc. | `evo/cordis`, `evo/deepseek` |
| Web carrier | — | `evo-web` (bare name) |
| Service key | `ctx.evoMemory` | `ctx.evo` |
| HTTP prefix | `/evo-memory/*` | `/evo/*` |
| Data directory | `evo-memory/` | `evo/` |

## Compatibility Surface

### Database

If the platform default `evo/` directory has no `memory.db` but the pre-rename `evo-memory/` directory does, evo automatically uses the old file.

Move it to the new directory whenever convenient:

```bash
# macOS
mv ~/Library/Application\ Support/evo-memory/memory.db \
   ~/Library/Application\ Support/evo/memory.db

# Linux
mv ~/.local/share/evo-memory/memory.db \
   ~/.local/share/evo/memory.db
```

### Environment Variables

Old variables are still read, after their new counterparts:

| Legacy | Current |
| --- | --- |
| `EVO_MEMORY_DATA_DIR` | `EVO_DATA_DIR` |
| `EVO_MEMORY_PROVIDER` | `EVO_PROVIDER` |
| `EVO_MEMORY_MODEL` | `EVO_MODEL` |

### HTTP API

The old path prefix `/evo-memory/*` is mounted alongside `/evo/*`. Both work identically.

## Required Changes

### Plugin Configuration

Update your `cordis.patch.yml`:

```yaml
# Old
- id: evo-memory
  name: evo-memory/cordis
  config: {}

- id: evo-memory-deepseek
  name: evo-memory/deepseek
  config:
    provider: deepseek-official
    model: deepseek-chat

# New
- id: evo
  name: evo/cordis
  config: {}

- id: evo-deepseek
  name: evo/deepseek
  config:
    provider: deepseek-official
    model: deepseek-chat

- id: evo-web
  name: evo
  config: {}
```

### Service Usage

Update any code using the service:

```ts
// Old
await ctx.evoMemory.remember({ ... })
await ctx.evoMemory.recall({ ... })

// New
await ctx.evo.remember({ ... })
await ctx.evo.recall({ ... })
```

### Installers

Re-run the appropriate installer to update hook configurations:

```bash
# DeepSeek Harness
./install_evo_dsps.sh

# Claude Code
./install_evo_claude.sh

# Codex
./install_evo_codex.sh
```

## No Data Migration Needed

Your existing memories are preserved. The database schema hasn't changed — only the package name and default paths.
