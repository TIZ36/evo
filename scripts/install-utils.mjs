/**
 * Shared utilities for evo install scripts. Used by install_evo_claude.sh and
 * install_evo_codex.sh via inline Node.js evaluation.
 *
 * The isEvoHook function recognizes all known evo hook command patterns:
 * - Script-style: node /path/to/evo/dist/hook/cli.mjs
 * - Plugin-style: node ${PLUGIN_ROOT}/bin/hook.mjs
 * - Global npm:   evo-hook
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Quote one argument for a POSIX-compatible shell command string. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

/**
 * Matches any evo hook command, regardless of install method:
 * - hook/cli.mjs (script-style, dist or src)
 * - hook\\cli.mjs (Windows)
 * - bin/hook.mjs (plugin-style, PLUGIN_ROOT or CLAUDE_PLUGIN_ROOT)
 * - evo-hook (global npm install, standalone or as path)
 * - evo-memory (legacy package name)
 */
export function isEvoHook(hook) {
  if (typeof hook?.command !== 'string') return false
  const cmd = hook.command
  // Script-style: hook/cli.mjs or hook\cli.mjs
  if (/hook[/\\]cli\.mjs/.test(cmd)) return true
  // Plugin-style: bin/hook.mjs
  if (/bin[/\\]hook\.mjs/.test(cmd)) return true
  // Plugin-style with PLUGIN_ROOT variable
  if (/\$\{?PLUGIN_ROOT/.test(cmd) && /hook\.mjs/.test(cmd)) return true
  if (/\$\{?CLAUDE_PLUGIN_ROOT/.test(cmd) && /hook\.mjs/.test(cmd)) return true
  if (/\$\{?CODEX_PLUGIN_ROOT/.test(cmd) && /hook\.mjs/.test(cmd)) return true
  // Global npm install: evo-hook or evo-memory as standalone command or at end of path
  // Match word boundary or path separator before, and word boundary or end after
  if (/(^|[/\\])evo-hook(\s|$)/.test(cmd)) return true
  if (/(^|[/\\])evo-memory(\s|$)/.test(cmd)) return true
  return false
}

/**
 * Checks if the evo plugin is installed via Claude Code marketplace.
 * Returns the plugin path if found, null otherwise.
 */
export function findClaudePlugin(claudeDir) {
  const pluginsDir = join(claudeDir, 'plugins')
  if (!existsSync(pluginsDir)) return null
  try {
    for (const entry of readdirSync(pluginsDir)) {
      const pluginJson = join(pluginsDir, entry, '.claude-plugin', 'plugin.json')
      if (existsSync(pluginJson)) {
        try {
          const manifest = JSON.parse(readFileSync(pluginJson, 'utf8'))
          if (manifest.name === 'evo') return join(pluginsDir, entry)
        } catch { /* skip malformed manifests */ }
      }
    }
  } catch { /* plugins dir not readable */ }
  return null
}

/**
 * Checks authoritative `codex plugin list --json` output for an installed evo
 * plugin. Cache directories are deliberately ignored because Codex retains
 * stale cached versions after a plugin is removed.
 * Returns the installed plugin metadata and its canonical selector.
 */
export function findCodexPlugin(pluginList) {
  const installed = Array.isArray(pluginList?.installed) ? pluginList.installed : []
  const plugin = installed.find(candidate => candidate?.name === 'evo' && candidate?.installed === true)
  if (!plugin) return null

  const marketplaceName = typeof plugin.marketplaceName === 'string' ? plugin.marketplaceName : undefined
  const selector = typeof plugin.pluginId === 'string'
    ? plugin.pluginId
    : marketplaceName
      ? `evo@${marketplaceName}`
      : 'evo'

  return {
    selector,
    enabled: plugin.enabled === true,
    marketplaceName,
    version: typeof plugin.version === 'string' ? plugin.version : undefined,
  }
}

/**
 * Counts evo hooks in a Claude Code settings object.
 * Returns { count, events } where events is a list of event names with evo hooks.
 */
export function countEvoHooks(settings) {
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

/**
 * Finds project-level evo hooks in .claude/settings.local.json.
 * Returns { found, path, count } or { found: false } if none.
 */
export function findProjectClaudeHooks(cwd) {
  const projectSettings = join(cwd, '.claude', 'settings.local.json')
  if (!existsSync(projectSettings)) return { found: false }
  try {
    const settings = JSON.parse(readFileSync(projectSettings, 'utf8'))
    const { count, events } = countEvoHooks(settings)
    if (count > 0) return { found: true, path: projectSettings, count, events }
  } catch { /* not readable JSON */ }
  return { found: false }
}

/**
 * Finds project-level evo hooks in Codex project config.
 * The project hooks file path varies by Codex version.
 */
export function findProjectCodexHooks(cwd) {
  const possiblePaths = [
    join(cwd, '.codex', 'hooks.json'),
    join(cwd, 'codex.hooks.json'),
  ]
  for (const hooksPath of possiblePaths) {
    if (!existsSync(hooksPath)) continue
    try {
      const settings = JSON.parse(readFileSync(hooksPath, 'utf8'))
      const { count, events } = countEvoHooks(settings)
      if (count > 0) return { found: true, path: hooksPath, count, events }
    } catch { /* not readable JSON */ }
  }
  return { found: false }
}

/**
 * Removes all evo hooks from a Claude Code / Codex settings object.
 * Returns { settings, removed } where removed is the count of hooks removed.
 */
export function stripEvoHooks(settings) {
  const hooks = settings?.hooks
  if (!hooks || typeof hooks !== 'object') return { settings, removed: 0 }
  let removed = 0
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
  return { settings: { ...settings, hooks }, removed }
}

/**
 * Adds evo hooks to a settings object for the given events.
 * Returns the modified settings object.
 */
export function addEvoHooks(settings, command, events) {
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? { ...settings.hooks } : {}
  for (const [event, { timeout }] of Object.entries(events)) {
    hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'command', command, timeout }] }]
  }
  return { ...settings, hooks }
}
