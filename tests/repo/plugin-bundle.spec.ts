import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Claude Code copies a plugin without building it and only restores npm or bun
 * lockfiles, so the committed bundle is the whole plugin. If it drifts from the
 * source, the plugin ships stale or broken.
 */
const BUNDLE = 'plugin/bin/hook.mjs'

describe('plugin bundle', () => {
  const source = readFileSync(BUNDLE, 'utf8')

  it('is an executable node entry', () => {
    expect(source.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(statSync(BUNDLE).mode & 0o111).toBeTruthy()
  })

  it('carries the current hook behaviour, not an older build', () => {
    for (const marker of ['EVO_HOOK_DISABLE', 'hook-notice.json', 'memory unavailable', 'UserPromptSubmit']) {
      expect(source).toContain(marker)
    }
  })

  it('depends on nothing outside the node runtime', () => {
    const imports = [...source.matchAll(/from\s*"([^"]+)"/g)].map(match => match[1]!)
    expect(imports.filter(name => !name.startsWith('node:'))).toEqual([])
  })

  it('is declared by the plugin manifest and its hooks', () => {
    const manifest = JSON.parse(readFileSync('plugin/.claude-plugin/plugin.json', 'utf8'))
    expect(manifest.name).toBe('evo')
    const hooks = JSON.parse(readFileSync('plugin/hooks/hooks.json', 'utf8'))
    for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
      expect(JSON.stringify(hooks.hooks[event])).toContain('${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs')
    }
    const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
    expect(marketplace.plugins.map((plugin: { name: string }) => plugin.name)).toContain('evo')
  })
})
