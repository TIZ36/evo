import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Both hosts copy a plugin without building it — Claude Code restores only npm
 * or bun lockfiles, Codex restores nothing — so the committed bundle is the
 * whole plugin. If it drifts from the source, the plugin ships stale or broken.
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

  it('uses each host\u2019s standard hook discovery and one shared hooks file', () => {
    const claudeManifest = JSON.parse(readFileSync('plugin/.claude-plugin/plugin.json', 'utf8'))
    expect(claudeManifest.name).toBe('evo')
    expect(claudeManifest.hooks).toBe('./hooks/hooks.json')

    const codexManifest = JSON.parse(readFileSync('plugin/.codex-plugin/plugin.json', 'utf8'))
    expect(codexManifest.name).toBe('evo')
    expect(codexManifest).not.toHaveProperty('hooks')
    expect(codexManifest.author.name).toBeTruthy()
    expect(codexManifest.interface.defaultPrompt.length).toBeGreaterThan(0)

    // Codex exports PLUGIN_ROOT; Claude Code exports only CLAUDE_PLUGIN_ROOT.
    const hooks = JSON.parse(readFileSync('plugin/hooks/hooks.json', 'utf8'))
    for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
      expect(JSON.stringify(hooks.hooks[event])).toContain('${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/bin/hook.mjs')
    }
  })

  it('is offered by a marketplace for each host, from the one plugin directory', () => {
    const claude = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
    expect(claude.plugins.map((plugin: { name: string }) => plugin.name)).toContain('evo')
    expect(claude.plugins[0].source).toBe('./plugin')

    const codex = JSON.parse(readFileSync('.agents/plugins/marketplace.json', 'utf8'))
    expect(codex.plugins.map((plugin: { name: string }) => plugin.name)).toContain('evo')
    expect(codex.plugins[0].source).toEqual({ source: 'local', path: './plugin' })
    expect(codex.plugins[0].policy).toEqual({ installation: 'AVAILABLE', authentication: 'ON_INSTALL' })
  })
})
