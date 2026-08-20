#!/usr/bin/env node
/**
 * Project-scope maintenance.
 *
 * Scope ids are compared as plain strings, so a project's memories become
 * unreachable when its directory moves, or when it was first recorded through a
 * non-canonical path (`/tmp/x` vs `/private/tmp/x` on macOS).
 *
 *   node scripts/migrate-project-scope.mjs --canonicalize [--apply]
 *   node scripts/migrate-project-scope.mjs --from <old-path> --to <new-path> [--apply]
 *
 * Without --apply the script only reports what it would change.
 */
import { realpathSync } from 'node:fs'
import { resolveDataPaths, SqliteMemoryStore } from '../dist/index.mjs'

const argv = process.argv.slice(2)
const flag = name => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const apply = argv.includes('--apply')
const canonicalize = argv.includes('--canonicalize')
const from = flag('--from')
const to = flag('--to')

if (!canonicalize && !(from && to)) {
  console.error('usage: --canonicalize | --from <old> --to <new>   [--apply]')
  process.exit(2)
}

const databasePath = flag('--database') ?? resolveDataPaths().databasePath
const store = new SqliteMemoryStore(databasePath)
const items = await store.list({ limit: 100000 })
const changes = []

for (const item of items) {
  if (item.scope.type !== 'project' || !item.scope.id) continue
  const target = canonicalize ? canonical(item.scope.id) : rewrite(item.scope.id)
  if (target && target !== item.scope.id) changes.push({ item, target })
}

console.log(`database: ${databasePath}`)
console.log(`${items.length} memories, ${changes.length} to move${apply ? '' : ' (dry run)'}`)
for (const { item, target } of group(changes)) console.log(`  ${item} -> ${target}`)

if (apply) {
  for (const { item, target } of changes) {
    await store.put({ ...item, scope: { ...item.scope, id: target } })
  }
  console.log(`moved ${changes.length} memories`)
}
store.close?.()

function canonical(id) {
  try { return realpathSync(id) } catch { return id }
}

function rewrite(id) {
  if (id === from) return to
  return id.startsWith(`${from}/`) ? `${to}${id.slice(from.length)}` : id
}

/** One line per distinct scope move, not per memory. */
function group(entries) {
  const seen = new Map()
  for (const entry of entries) {
    const key = `${entry.item.scope.id} -> ${entry.target}`
    if (!seen.has(key)) seen.set(key, { item: entry.item.scope.id, target: entry.target })
  }
  return [...seen.values()]
}
