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
HOOK_COMMAND="node --no-warnings $HOOK_ENTRY"
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

if [[ ! -f "$SCRIPT_DIR/package.json" ]]; then
  echo "evo: run this script from an intact evo checkout" >&2
  exit 1
fi

if [[ "$MODE" == "install" ]]; then
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
node --input-type=module - "$SETTINGS" "$HOOK_ENTRY" "$MODE" <<'NODE'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

const [, , settingsPath, hookEntry, mode] = process.argv

/** Hook events evo takes part in. Extend here; re-running the script applies it. */
const EVENTS = {
  SessionStart: { timeout: 20 },
  UserPromptSubmit: { timeout: 20 },
  Stop: { timeout: 20 },
}
const command = `node --no-warnings ${hookEntry}`
/** Any evo hook, including ones installed from an older checkout path. */
const isEvoHook = hook => typeof hook?.command === 'string' && /hook[/\\]cli\.mjs/.test(hook.command)

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
  echo "evo: uninstalled from $SETTINGS"
  exit 0
fi

# Prove the installed command actually answers before claiming success.
PROBE=$(printf '{"hook_event_name":"UserPromptSubmit","cwd":"%s","session_id":"install-probe"}' "$SCRIPT_DIR" \
  | EVO_HOOK_HOST=codex node --no-warnings "$HOOK_ENTRY" || true)
DATA_DIR=$(node --no-warnings --input-type=module -e \
  "import { resolveDataPaths } from '$SCRIPT_DIR/dist/index.mjs'; console.log(resolveDataPaths().databasePath)")

cat <<EOF
evo: installed successfully
  hooks:   $SETTINGS
  hook:    $HOOK_COMMAND
  storage: $DATA_DIR
  probe:   $(if [[ -n "$PROBE" ]]; then echo "recalled memory for this checkout"; else echo "no memory yet for this checkout (expected on a fresh store)"; fi)

Open a new Codex session for the hooks to load. Codex asks you to trust a hook
command the first time it runs one — answer yes, or evo stays inert.
Installing the plugin as well would run evo twice per turn — pick one.

Optional runtime overrides:
  EVO_HOOK_REFLECT=0   recall only, never write memory
  EVO_HOOK_NOTIFY=0    remove the transcript line
  EVO_HOOK_DEBUG=1     log every recall, import and reflection
  EVO_HOOK_MODEL=...   model used for reflection (default: your Codex model)
EOF
