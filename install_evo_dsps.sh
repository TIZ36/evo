#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${DSH_PROFILE:-web}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"

for command in node pnpm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "evo: required command not found: $command" >&2
    exit 127
  fi
done

# Resolve the Harness CLI. An installed `dsh` wins: the profile it writes is
# then read back by the very CLI that will boot it, so `plugin add` semantics
# and the composed tree cannot disagree across versions. An explicit
# DSH_PACKAGE overrides that; with neither, fall back to a pinned release.
DSH_PACKAGE_DEFAULT="@deepseek-ai/dsh@0.1.0-rc.6"
if [[ -n "${DSH_PACKAGE:-}" ]]; then
  DSH_CLI=(npx --yes "$DSH_PACKAGE")
  DSH_ORIGIN="npx $DSH_PACKAGE (DSH_PACKAGE)"
  DSH_BOOT_HINT="npx $DSH_PACKAGE --profile $PROFILE"
elif command -v dsh >/dev/null 2>&1; then
  DSH_CLI=(dsh)
  DSH_ORIGIN="dsh on PATH ($(command -v dsh))"
  DSH_BOOT_HINT="dsh --profile $PROFILE"
else
  DSH_CLI=(npx --yes "$DSH_PACKAGE_DEFAULT")
  DSH_ORIGIN="npx $DSH_PACKAGE_DEFAULT (no dsh on PATH)"
  DSH_BOOT_HINT="npx $DSH_PACKAGE_DEFAULT --profile $PROFILE"
fi

if [[ "${DSH_CLI[0]}" == "npx" ]] && ! command -v npx >/dev/null 2>&1; then
  echo "evo: required command not found: npx (install dsh, or provide npx)" >&2
  exit 127
fi

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

echo "evo: installing bundle into DeepSeek Harness profile '$PROFILE' via $DSH_ORIGIN"
"${DSH_CLI[@]}" plugin --profile "$PROFILE" add --workspace-root "link:$SCRIPT_DIR"

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
if (manifest.dependencies?.['@tiz36/evo'] === undefined) {
  throw new Error('evo is absent from profile dependencies')
}
if (!manifest.dsh?.profile?.bundles?.includes('@tiz36/evo')) {
  throw new Error('evo was installed but not activated as a DSH bundle')
}
const installed = join(profileDir, 'node_modules', '@tiz36', 'evo', 'cordis.patch.yml')
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
  $DSH_BOOT_HINT

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
