#!/usr/bin/env node
/**
 * Profile Doctor — find stale evo installs in a DSH profile.
 *
 * A profile can end up carrying the same package under several names: an
 * alias left by an older install command, or evo's own former published names.
 * Every one of them resolves to the same `cordis.patch.yml`, so DSH applies
 * that patch once per name — inserting the same plugin ids repeatedly, and
 * offering the client-module scan two graph rows with one id. The profile
 * stops booting, and the error names neither the alias nor the duplication.
 *
 * The installer runs this after `plugin add` and removes whatever it reports,
 * so a re-run repairs a profile instead of inheriting its history.
 *
 * A name is reported only when it is provably evo:
 *   - it resolves to a package whose manifest name is the canonical one, or
 *   - it is one of evo's former names AND resolves to nothing (a dangling
 *     link left by a checkout that has since moved or been deleted).
 *
 * A name that resolves to some *other* package is never reported, however
 * suggestive it looks — `evo` is a real name on the registry, and removing a
 * dependency the user meant to install would be worse than the duplication.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTRY = resolve(fileURLToPath(import.meta.url))

/** Names evo published under before `@tiz36/evo`. */
export const LEGACY_NAMES = ['evo', 'evo-memory']

/** Read a JSON file, or null when it is absent or unreadable. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Names in the profile manifest that are evo under another name.
 *
 * @param {object} options
 * @param {object} options.manifest - parsed profile package.json
 * @param {string} options.profileDir - directory holding the profile's node_modules
 * @param {string} options.canonical - the name evo publishes under today
 * @returns {{ stale: string[]; skipped: Array<{ name: string; resolvedTo: string }> }}
 */
export function findStaleEvoInstalls({ manifest, profileDir, canonical }) {
  const stale = []
  const skipped = []
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (name === canonical) continue
    const installed = readJson(join(profileDir, 'node_modules', name, 'package.json'))
    if (installed !== null) {
      if (installed.name === canonical) stale.push(name)
      else if (LEGACY_NAMES.includes(name)) skipped.push({ name, resolvedTo: String(installed.name) })
      continue
    }
    // Unresolvable: only evo's own former names are ours to clean up.
    if (LEGACY_NAMES.includes(name)) stale.push(name)
  }
  return { stale, skipped }
}

// CLI: print one stale dependency name per line on stdout (the installer feeds
// them straight to `plugin remove`), and anything refused on stderr.
if (resolve(process.argv[1] ?? '') === ENTRY) {
  const [, , manifestPath, profileDir, canonical] = process.argv
  const manifest = readJson(manifestPath)
  if (manifest === null) {
    process.stderr.write(`profile-doctor: cannot read ${manifestPath}\n`)
    process.exit(1)
  }
  const { stale, skipped } = findStaleEvoInstalls({ manifest, profileDir, canonical })
  for (const { name, resolvedTo } of skipped) {
    process.stderr.write(`evo: leaving "${name}" alone — it resolves to ${resolvedTo}, not ${canonical}\n`)
  }
  for (const name of stale) process.stdout.write(`${name}\n`)
}
