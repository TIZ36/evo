#!/usr/bin/env bash
# Install evo's Codex hooks into the user-level configuration, for every project.
#
# Re-running is the supported way to upgrade: evo's own entries are replaced with
# the current set (including hook events added by later versions), and every
# other hook in the file is left untouched.
#
#   ./install_evo_codex.sh              install or refresh
#   ./install_evo_codex.sh --uninstall  remove evo's entries
#   CODEX_HOME=/tmp/x ./install_evo_codex.sh   target another Codex home
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
SETTINGS="$CODEX_DIR/hooks.json"
HOOK_ENTRY="$SCRIPT_DIR/dist/hook/cli.mjs"
INSTALL_UTILS="$SCRIPT_DIR/scripts/install-utils.mjs"
MODE="install"

for argument in "$@"; do
  case "$argument" in
    --uninstall) MODE="uninstall" ;;
    *) echo "evo: unknown argument: $argument" >&2; exit 2 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "evo: required command not found: node" >&2
  exit 127
fi

if [[ ! -f "$SCRIPT_DIR/package.json" || ! -f "$INSTALL_UTILS" ]]; then
  echo "evo: run this script from an intact evo checkout" >&2
  exit 1
fi

INSTALLED_EVO_PLUGIN=""
if command -v codex >/dev/null 2>&1; then
  if PLUGIN_LIST_JSON="$(codex plugin list --json 2>/dev/null)"; then
    INSTALLED_EVO_PLUGIN="$(
      printf '%s' "$PLUGIN_LIST_JSON" | node --input-type=module -e '
        import { pathToFileURL } from "node:url"
        const { findCodexPlugin } = await import(pathToFileURL(process.argv[1]).href)
        let input = ""
        for await (const chunk of process.stdin) input += chunk
        const plugin = findCodexPlugin(JSON.parse(input))
        if (plugin) process.stdout.write(plugin.selector)
      ' "$INSTALL_UTILS"
    )"
  elif [[ "$MODE" == "install" ]]; then
    echo "evo: could not inspect installed Codex plugins" >&2
    echo "     Run 'codex plugin list --json' to diagnose the plugin configuration." >&2
    exit 1
  fi
elif [[ "$MODE" == "install" ]]; then
  echo "evo: required command not found: codex" >&2
  exit 127
fi

if [[ "$MODE" == "install" && -n "$INSTALLED_EVO_PLUGIN" ]]; then
  echo "evo: marketplace plugin is already installed as $INSTALLED_EVO_PLUGIN" >&2
  echo "     Using both plugin and script would run evo twice per turn." >&2
  echo >&2
  echo "     To use this script instead, first remove the plugin:" >&2
  echo "       codex plugin remove $INSTALLED_EVO_PLUGIN" >&2
  echo "     Then run this script again." >&2
  echo >&2
  echo "     Or keep the plugin and skip this script." >&2
  exit 1
fi

if [[ "$MODE" == "install" ]]; then
  if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)'; then
    echo "evo: Node.js 22.19.0 or newer is required (found $(node --version))" >&2
    exit 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "evo: required command not found: pnpm" >&2
    exit 127
  fi
  echo "evo: building package"
  pnpm --dir "$SCRIPT_DIR" install --frozen-lockfile
  pnpm --dir "$SCRIPT_DIR" build
  if [[ ! -f "$HOOK_ENTRY" ]]; then
    echo "evo: build did not emit $HOOK_ENTRY" >&2
    exit 1
  fi
fi

mkdir -p "$CODEX_DIR"
node --input-type=module - "$SETTINGS" "$HOOK_ENTRY" "$MODE" "$INSTALL_UTILS" <<'NODE'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [, , settingsPath, hookEntry, mode, installUtils] = process.argv
const { shellQuote } = await import(pathToFileURL(installUtils).href)

/** Hook events evo takes part in. Extend here; re-running the script applies it. */
const EVENTS = {
  SessionStart: { timeout: 20 },
  UserPromptSubmit: { timeout: 20 },
  Stop: { timeout: 20 },
}
const command = `node --no-warnings ${shellQuote(hookEntry)}`

/**
 * Matches any evo hook command, regardless of install method:
 * - hook/cli.mjs (script-style, dist or src)
 * - hook\\cli.mjs (Windows)
 * - bin/hook.mjs (plugin-style, PLUGIN_ROOT or CODEX_PLUGIN_ROOT)
 * - evo-hook (global npm install)
 * - evo-memory (legacy package name)
 */
function isEvoHook(hook) {
  if (typeof hook?.command !== 'string') return false
  const cmd = hook.command
  // Script-style: hook/cli.mjs or hook\cli.mjs
  if (/hook[/\\]cli\.mjs/.test(cmd)) return true
  // Plugin-style: bin/hook.mjs
  if (/bin[/\\]hook\.mjs/.test(cmd)) return true
  // Plugin-style with PLUGIN_ROOT variable
  if (/\$\{?PLUGIN_ROOT/.test(cmd) && /hook\.mjs/.test(cmd)) return true
  if (/\$\{?CODEX_PLUGIN_ROOT/.test(cmd) && /hook\.mjs/.test(cmd)) return true
  // Global npm install: evo-hook or evo-memory as standalone command or at end of path
  if (/(^|[/\\])evo-hook(\s|$)/.test(cmd)) return true
  if (/(^|[/\\])evo-memory(\s|$)/.test(cmd)) return true
  return false
}

/** Counts evo hooks in a settings object. */
function countEvoHooks(settings) {
  const hooks = settings?.hooks
  if (!hooks || typeof hooks !== 'object') return { count: 0, events: [] }
  let count = 0
  const events = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      const inner = Array.isArray(group?.hooks) ? group.hooks : []
      const evoCount = inner.filter(isEvoHook).length
      if (evoCount > 0) {
        count += evoCount
        if (!events.includes(event)) events.push(event)
      }
    }
  }
  return { count, events }
}

// ── Load and back up existing settings ────────────────────────────────────
let settings = {}
let existed = false
try {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  existed = true
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error(`${settingsPath} is not readable JSON: ${error.message}`)
}
if (existed) {
  const backup = `${settingsPath}.evo-backup`
  copyFileSync(settingsPath, backup)
  console.log(`evo: backed up ${settingsPath} -> ${backup}`)
}

const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}
let removed = 0

// Drop evo's previous entries wherever they sit, keeping every other hook.
for (const [event, groups] of Object.entries(hooks)) {
  if (!Array.isArray(groups)) continue
  const kept = []
  for (const group of groups) {
    const inner = Array.isArray(group?.hooks) ? group.hooks : []
    const survivors = inner.filter(hook => !isEvoHook(hook))
    removed += inner.length - survivors.length
    if (survivors.length) kept.push({ ...group, hooks: survivors })
    else if (!inner.length) kept.push(group)
  }
  if (kept.length) hooks[event] = kept
  else delete hooks[event]
}

if (mode === 'install') {
  for (const [event, { timeout }] of Object.entries(EVENTS)) {
    hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'command', command, timeout }] }]
  }
}

settings.hooks = hooks
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)

if (mode === 'install') {
  console.log(`evo: ${removed ? `replaced ${removed} previous entr${removed === 1 ? 'y' : 'ies'}, ` : ''}installed ${Object.keys(EVENTS).length} hooks`)
  for (const event of Object.keys(EVENTS)) console.log(`  ${event}`)
} else {
  console.log(`evo: removed ${removed} hook entr${removed === 1 ? 'y' : 'ies'}`)
}
NODE

if [[ "$MODE" == "uninstall" ]]; then
  if [[ -n "$INSTALLED_EVO_PLUGIN" ]]; then
    echo "evo: note: marketplace plugin is still installed as $INSTALLED_EVO_PLUGIN"
    echo "     To fully remove evo, also run: codex plugin remove $INSTALLED_EVO_PLUGIN"
  fi
  echo "evo: uninstalled from $SETTINGS"
  exit 0
fi

# ── Project-level hook warning ─────────────────────────────────────────────
# Check cwd for project-level hooks that would cause double execution
node --input-type=module - "$(pwd)" <<'NODE'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , cwd] = process.argv

function isEvoHook(hook) {
  if (typeof hook?.command !== 'string') return false
  const cmd = hook.command
  if (/hook[/\\]cli\.mjs/.test(cmd)) return true
  if (/bin[/\\]hook\.mjs/.test(cmd)) return true
  if (/\$\{?PLUGIN_ROOT/.test(cmd) && /hook\.mjs/.test(cmd)) return true
  if (/\$\{?CODEX_PLUGIN_ROOT/.test(cmd) && /hook\.mjs/.test(cmd)) return true
  if (/(^|[/\\])evo-hook(\s|$)/.test(cmd)) return true
  if (/(^|[/\\])evo-memory(\s|$)/.test(cmd)) return true
  return false
}

const possiblePaths = [
  join(cwd, '.codex', 'hooks.json'),
  join(cwd, 'codex.hooks.json'),
]

for (const projectSettings of possiblePaths) {
  if (!existsSync(projectSettings)) continue
  try {
    const settings = JSON.parse(readFileSync(projectSettings, 'utf8'))
    const hooks = settings?.hooks
    if (!hooks || typeof hooks !== 'object') continue
    
    let count = 0
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue
      for (const group of groups) {
        const inner = Array.isArray(group?.hooks) ? group.hooks : []
        count += inner.filter(isEvoHook).length
      }
    }
    
    if (count > 0) {
      console.log(``)
      console.log(`evo: WARNING: project-level evo hooks found in ${projectSettings}`)
      console.log(`     Global + project hooks will run evo twice per turn.`)
      console.log(`     Remove the project hooks to avoid double execution:`)
      console.log(`       rm "${projectSettings}"`)
      console.log(`     Or edit it to remove the evo entries from hooks.`)
      break
    }
  } catch { /* not readable JSON */ }
}
NODE

# Prove the installed command actually answers before claiming success.
PROBE=$(printf '{"hook_event_name":"UserPromptSubmit","cwd":"%s","session_id":"install-probe"}' "$SCRIPT_DIR" \
  | EVO_HOOK_HOST=codex node --no-warnings "$HOOK_ENTRY" || true)
DATA_DIR=$(node --no-warnings --input-type=module -e \
  "import { resolveDataPaths } from '$SCRIPT_DIR/dist/index.mjs'; console.log(resolveDataPaths().databasePath)")

cat <<EOF
evo: installed successfully
  hooks:   $SETTINGS
  hook:    node --no-warnings '$HOOK_ENTRY'
  storage: $DATA_DIR
  probe:   $(if [[ -n "$PROBE" ]]; then echo "recalled memory for this checkout"; else echo "no memory yet for this checkout (expected on a fresh store)"; fi)

Open a new Codex session for the hooks to load. Codex asks you to trust a hook
command the first time it runs one — answer yes, or evo stays inert.

Optional runtime overrides:
  EVO_HOOK_REFLECT=0   recall only, never write memory
  EVO_HOOK_NOTIFY=0    remove the transcript line
  EVO_HOOK_DEBUG=1     log every recall, import and reflection
  EVO_HOOK_MODEL=...   model used for reflection (default: your Codex model)
EOF
