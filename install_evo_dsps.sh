#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${DSH_PROFILE:-web}"
DSH_PACKAGE="${DSH_PACKAGE:-@deepseek-ai/dsh@0.1.0-rc.6}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"

for command in node pnpm npx; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "evo: required command not found: $command" >&2
    exit 127
  fi
done

if [[ ! -f "$SCRIPT_DIR/package.json" || ! -f "$SCRIPT_DIR/cordis.patch.yml" ]]; then
  echo "evo: run this script from an intact evo checkout" >&2
  exit 1
fi

echo "evo: building package"
pnpm --dir "$SCRIPT_DIR" install --frozen-lockfile
pnpm --dir "$SCRIPT_DIR" build

if [[ ! -f "$SCRIPT_DIR/dist/client.js" ]]; then
  echo "evo: dist/client.js is missing — the build did not emit the web client bundle" >&2
  exit 1
fi

echo "evo: installing bundle into DeepSeek Harness profile '$PROFILE'"
npx --yes "$DSH_PACKAGE" plugin --profile "$PROFILE" add --workspace-root "link:$SCRIPT_DIR"

PROFILE_MANIFEST="$PROFILE_DIR/package.json"
if [[ ! -f "$PROFILE_MANIFEST" ]]; then
  echo "evo: profile manifest was not created: $PROFILE_MANIFEST" >&2
  exit 1
fi

node --input-type=module - "$PROFILE_MANIFEST" "$PROFILE_DIR" <<'NODE'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , manifestPath, profileDir] = process.argv
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.dependencies?.['evo'] === undefined) {
  throw new Error('evo is absent from profile dependencies')
}
if (!manifest.dsh?.profile?.bundles?.includes('evo')) {
  throw new Error('evo was installed but not activated as a DSH bundle')
}
const installed = join(profileDir, 'node_modules', 'evo', 'cordis.patch.yml')
const patch = readFileSync(installed, 'utf8')
if (!patch.includes('id: evo-web')) {
  throw new Error('evo bundle patch is missing the web client carrier row (evo-web)')
}
NODE

cat <<EOF
evo: installed successfully
  profile:  $PROFILE
  manifest: $PROFILE_MANIFEST
  storage:  ${EVO_DATA_DIR:-platform default}/memory.db

Start Harness as usual:
  npx $DSH_PACKAGE --profile $PROFILE

After startup (web profile):
  - Settings -> Memory shows the native memory panel (memories, activity log,
    consolidate / workspace re-import).
  - HTTP API is reserved at /evo/* for external frontends
    (status, memories, memories/:id, events, consolidate, import-workspace).
  - Project memory auto-imports on first prompt in a workspace with
    .claude/.codex/.copilot/.agent/.paper files.

Optional runtime overrides:
  EVO_PROVIDER=deepseek-official
  EVO_MODEL=deepseek-v4-flash
  EVO_DATA_DIR=/absolute/path
EOF
