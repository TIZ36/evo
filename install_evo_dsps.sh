#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${DSH_PROFILE:-web}"
DSH_PACKAGE="${DSH_PACKAGE:-@deepseek-ai/dsh@0.1.0-rc.6}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"

for command in node pnpm npx; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "evo-memory: required command not found: $command" >&2
    exit 127
  fi
done

if [[ ! -f "$SCRIPT_DIR/package.json" || ! -f "$SCRIPT_DIR/cordis.patch.yml" ]]; then
  echo "evo-memory: run this script from an intact evo-memory checkout" >&2
  exit 1
fi

echo "evo-memory: building package"
pnpm --dir "$SCRIPT_DIR" install --frozen-lockfile
pnpm --dir "$SCRIPT_DIR" build

echo "evo-memory: installing bundle into DeepSeek Harness profile '$PROFILE'"
npx --yes "$DSH_PACKAGE" plugin --profile "$PROFILE" add --workspace-root "link:$SCRIPT_DIR"

PROFILE_MANIFEST="$PROFILE_DIR/package.json"
if [[ ! -f "$PROFILE_MANIFEST" ]]; then
  echo "evo-memory: profile manifest was not created: $PROFILE_MANIFEST" >&2
  exit 1
fi

node --input-type=module - "$PROFILE_MANIFEST" "$PROFILE_DIR" <<'NODE'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , manifestPath, profileDir] = process.argv
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.dependencies?.['evo-memory'] === undefined) {
  throw new Error('evo-memory is absent from profile dependencies')
}
if (!manifest.dsh?.profile?.bundles?.includes('evo-memory')) {
  throw new Error('evo-memory was installed but not activated as a DSH bundle')
}
const installed = join(profileDir, 'node_modules', 'evo-memory', 'cordis.patch.yml')
readFileSync(installed, 'utf8')
NODE

cat <<EOF
evo-memory: installed successfully
  profile:  $PROFILE
  manifest: $PROFILE_MANIFEST
  storage:  ${EVO_MEMORY_DATA_DIR:-platform default}/memory.db

Start Harness as usual:
  npx $DSH_PACKAGE --profile $PROFILE

Optional runtime overrides:
  EVO_MEMORY_PROVIDER=deepseek-official
  EVO_MEMORY_MODEL=deepseek-v4-flash
  EVO_MEMORY_DATA_DIR=/absolute/path
EOF
