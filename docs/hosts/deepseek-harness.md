# DeepSeek Harness

evo integrates with DeepSeek Harness as a Cordis plugin, providing automatic recall and reflection plus a web-based Settings → Memory panel.

## Quick Install

For an npx-managed Harness profile:

```bash
./install_evo_dsps.sh
```

This builds the package, installs a local link through `dsh plugin`, and activates evo as a DSH bundle. The default profile is `web`; override with `DSH_PROFILE=tui` or another profile name.

It prefers a `dsh` already on your `PATH`, so the CLI that writes the profile is the one that later boots it. Set `DSH_PACKAGE` to pin a released version through `npx` instead.

### Re-running repairs the profile

A profile can end up carrying evo under several names at once — an alias left by an older install command, or a former published name such as `evo-memory`. Each resolves to the same `cordis.patch.yml`, so DSH applies that patch once per name, inserting every evo plugin id more than once, and the profile stops booting with an error that names neither the alias nor the duplication.

Re-running the installer removes them:

```
evo: removing stale evo installs from profile 'web': evo evo-memory
```

A name is only removed when it is provably evo: it resolves to a package whose manifest name is `@tiz36/evo`, or it is one of evo's former names and resolves to nothing. A name that resolves to some *other* package is reported and left alone — `evo` is a real name on the registry.

The bundle uses `deepseek-official` and `deepseek-v4-flash` by default; override at launch with `EVO_PROVIDER` and `EVO_MODEL`.

## Manual Configuration

Add the plugins to your `cordis.patch.yml` after the Harness LLM and system-prompt services:

```yaml
- id: evo
  name: evo/cordis
  config: {}

- id: evo-deepseek
  name: evo/deepseek
  config:
    provider: deepseek-official
    model: deepseek-chat
    recallLimit: 40
    maxContextChars: 6000
    reflect: true

# Optional: web panel carrier
- id: evo-web
  name: evo
  config: {}
```

A copyable fragment is available in [`examples/cordis.yml`](https://github.com/TIZ36/evo/blob/main/examples/cordis.yml).

## How It Works

The adapter uses official Harness extension points:

| Extension Point | Role |
| --- | --- |
| `system-prompt/assemble` | Recalls global, project, and session memory into dynamic context |
| `session/event` | Observes successful `turn/end` events and reflects activity |
| `ctx.llm.stream()` | Runs reflection and consolidation through the configured model |

Interrupted, aborted, rejected, and failed turns are never reflected.

## Web Panel

The package ships a web client that adds a **Memory** page to Harness GUI Settings:

- Memory list with kind tabs and search
- Recent reflect/consolidate activity log
- Actions to consolidate a scope or force workspace re-import

The composer tool row also gets an **evo** chip that pulses during reflection. Clicking it opens Settings → Memory.

The client half is carried by the `evo-web` row in `cordis.patch.yml`. Restart Harness after upgrading so the new boot graph includes the panel.

## Configuration Options

| Option | Default | Description |
| --- | --- | --- |
| `provider` | — | Harness provider for reflection |
| `model` | — | Model for reflection and consolidation |
| `recallLimit` | `40` | Maximum memories to consider per recall |
| `maxContextChars` | `6000` | Character budget for injected context |
| `reflect` | `true` | Set `false` to recall only, never write |
| `workspaceImport` | `true` | Set `false` to skip automatic workspace import |
