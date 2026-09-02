#!/usr/bin/env node
/**
 * Hook Bundle Drift Check
 *
 * Claude Code / Codex marketplace copies the git tree and runs no build
 * (see tsdown.plugin.config.ts comment). The committed plugin/bin/hook.mjs
 * IS what marketplace users execute.
 *
 * This script:
 *   1. Rebuilds plugin/bin/hook.mjs from current src/hook/cli.ts
 *   2. Checks if the result differs from what's in git
 *   3. Fails CI if a source change forgot to commit the bundle
 *
 * Run as part of `pnpm check` to catch drift before merge.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE_PATH = join(ROOT, 'plugin/bin/hook.mjs')

function main() {
  console.log('[check-hook-drift] Rebuilding plugin/bin/hook.mjs...')
  
  const beforeBuild = readFileSafe(BUNDLE_PATH)
  
  try {
    execSync('pnpm plugin:build', { cwd: ROOT, stdio: 'inherit' })
  } catch (error) {
    console.error('[check-hook-drift] Build failed')
    process.exit(1)
  }
  
  const afterBuild = readFileSafe(BUNDLE_PATH)
  
  if (beforeBuild !== afterBuild) {
    console.error('[check-hook-drift] DRIFT DETECTED!')
    console.error('')
    console.error('plugin/bin/hook.mjs differs from git after rebuild.')
    console.error('This means src/hook changes were not committed with the rebuilt bundle.')
    console.error('')
    console.error('To fix:')
    console.error('  1. Run: pnpm plugin:build')
    console.error('  2. Commit plugin/bin/hook.mjs along with your source changes')
    console.error('')
    console.error('Marketplace users pick up hook changes only after the rebuilt')
    console.error('plugin/bin/hook.mjs is on the branch they installed from.')
    process.exit(1)
  }
  
  console.log('[check-hook-drift] OK: plugin/bin/hook.mjs matches source')
}

function readFileSafe(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

main()
