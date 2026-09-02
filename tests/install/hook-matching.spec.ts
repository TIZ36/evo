import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  isEvoHook,
  countEvoHooks,
  stripEvoHooks,
  addEvoHooks,
  findClaudePlugin,
  findCodexPlugin,
  findProjectClaudeHooks,
  findProjectCodexHooks,
} from '../../scripts/install-utils.mjs'

describe('isEvoHook', () => {
  describe('script-style hooks', () => {
    it('matches dist/hook/cli.mjs path', () => {
      expect(isEvoHook({ command: 'node --no-warnings /path/to/evo/dist/hook/cli.mjs' })).toBe(true)
    })

    it('matches hook/cli.mjs with various prefixes', () => {
      expect(isEvoHook({ command: 'node /opt/evo/dist/hook/cli.mjs' })).toBe(true)
      expect(isEvoHook({ command: 'node hook/cli.mjs' })).toBe(true)
      expect(isEvoHook({ command: '/usr/local/bin/node /opt/evo/hook/cli.mjs' })).toBe(true)
    })

    it('matches Windows-style backslash paths', () => {
      expect(isEvoHook({ command: 'node C:\\Users\\dev\\evo\\dist\\hook\\cli.mjs' })).toBe(true)
      expect(isEvoHook({ command: 'node "C:\\Program Files\\evo\\hook\\cli.mjs"' })).toBe(true)
    })
  })

  describe('plugin-style hooks', () => {
    it('matches bin/hook.mjs path', () => {
      expect(isEvoHook({ command: 'node --no-warnings "/path/to/plugin/bin/hook.mjs"' })).toBe(true)
    })

    it('matches PLUGIN_ROOT variable expansion', () => {
      expect(isEvoHook({ command: 'node --no-warnings "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/bin/hook.mjs"' })).toBe(true)
      expect(isEvoHook({ command: 'node --no-warnings "${PLUGIN_ROOT}/bin/hook.mjs"' })).toBe(true)
      expect(isEvoHook({ command: 'node "$PLUGIN_ROOT/bin/hook.mjs"' })).toBe(true)
    })

    it('matches CLAUDE_PLUGIN_ROOT variable', () => {
      expect(isEvoHook({ command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs"' })).toBe(true)
      expect(isEvoHook({ command: 'node "$CLAUDE_PLUGIN_ROOT/bin/hook.mjs"' })).toBe(true)
    })

    it('matches CODEX_PLUGIN_ROOT variable', () => {
      expect(isEvoHook({ command: 'node "${CODEX_PLUGIN_ROOT}/bin/hook.mjs"' })).toBe(true)
      expect(isEvoHook({ command: 'node "$CODEX_PLUGIN_ROOT/bin/hook.mjs"' })).toBe(true)
    })
  })

  describe('global npm install', () => {
    it('matches evo-hook command', () => {
      expect(isEvoHook({ command: 'evo-hook' })).toBe(true)
      expect(isEvoHook({ command: '/usr/local/bin/evo-hook' })).toBe(true)
    })

    it('matches evo-memory (legacy name)', () => {
      expect(isEvoHook({ command: 'evo-memory' })).toBe(true)
      expect(isEvoHook({ command: '/usr/local/bin/evo-memory' })).toBe(true)
    })
  })

  describe('non-evo hooks', () => {
    it('rejects unrelated hook commands', () => {
      expect(isEvoHook({ command: 'echo "hello"' })).toBe(false)
      expect(isEvoHook({ command: 'node other-hook.js' })).toBe(false)
      expect(isEvoHook({ command: 'python /path/to/hook.py' })).toBe(false)
    })

    it('rejects partial matches', () => {
      expect(isEvoHook({ command: 'node my-evo-hook.js' })).toBe(false)
      expect(isEvoHook({ command: 'node cli.mjs' })).toBe(false)
      expect(isEvoHook({ command: 'node hook.mjs' })).toBe(false)
    })

    it('rejects invalid hook objects', () => {
      expect(isEvoHook(null)).toBe(false)
      expect(isEvoHook(undefined)).toBe(false)
      expect(isEvoHook({})).toBe(false)
      expect(isEvoHook({ command: 123 })).toBe(false)
      expect(isEvoHook({ type: 'command' })).toBe(false)
    })
  })
})

describe('countEvoHooks', () => {
  it('counts hooks across multiple events', () => {
    const settings = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node dist/hook/cli.mjs' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node dist/hook/cli.mjs' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'node dist/hook/cli.mjs' }] }],
      },
    }
    const result = countEvoHooks(settings)
    expect(result.count).toBe(3)
    expect(result.events).toEqual(['SessionStart', 'UserPromptSubmit', 'Stop'])
  })

  it('handles mixed evo and non-evo hooks', () => {
    const settings = {
      hooks: {
        SessionStart: [
          { hooks: [
            { type: 'command', command: 'node dist/hook/cli.mjs' },
            { type: 'command', command: 'other-hook' },
          ] },
        ],
      },
    }
    const result = countEvoHooks(settings)
    expect(result.count).toBe(1)
    expect(result.events).toEqual(['SessionStart'])
  })

  it('returns zero for empty or missing hooks', () => {
    expect(countEvoHooks({})).toEqual({ count: 0, events: [] })
    expect(countEvoHooks({ hooks: {} })).toEqual({ count: 0, events: [] })
    expect(countEvoHooks(null)).toEqual({ count: 0, events: [] })
  })

  it('detects plugin-style hooks', () => {
    const settings = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node "${PLUGIN_ROOT}/bin/hook.mjs"' }] }],
      },
    }
    const result = countEvoHooks(settings)
    expect(result.count).toBe(1)
  })
})

describe('stripEvoHooks', () => {
  it('removes all evo hooks while keeping others', () => {
    const settings = {
      hooks: {
        SessionStart: [
          { hooks: [
            { type: 'command', command: 'node dist/hook/cli.mjs' },
            { type: 'command', command: 'other-hook', timeout: 10 },
          ] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'node bin/hook.mjs' }] },
        ],
      },
      otherSetting: true,
    }
    const result = stripEvoHooks(settings)
    expect(result.removed).toBe(2)
    expect(result.settings.otherSetting).toBe(true)
    expect(result.settings.hooks!.SessionStart).toHaveLength(1)
    expect(result.settings.hooks!.SessionStart![0].hooks).toHaveLength(1)
    expect(result.settings.hooks!.SessionStart![0].hooks![0].command).toBe('other-hook')
    expect(result.settings.hooks!.UserPromptSubmit).toBeUndefined()
  })

  it('removes both script-style and plugin-style hooks', () => {
    const settings = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'node /opt/evo/dist/hook/cli.mjs' }] },
          { hooks: [{ type: 'command', command: 'node "${PLUGIN_ROOT}/bin/hook.mjs"' }] },
        ],
      },
    }
    const result = stripEvoHooks(settings)
    expect(result.removed).toBe(2)
    expect(result.settings.hooks!.SessionStart).toBeUndefined()
  })

  it('handles empty groups gracefully', () => {
    const settings = {
      hooks: {
        SessionStart: [{ hooks: [] }],
      },
    }
    const result = stripEvoHooks(settings)
    expect(result.removed).toBe(0)
    expect(result.settings.hooks!.SessionStart).toHaveLength(1)
  })
})

describe('addEvoHooks', () => {
  it('adds hooks to empty settings', () => {
    const events = { SessionStart: { timeout: 20 }, Stop: { timeout: 20 } }
    const result = addEvoHooks({}, 'node dist/hook/cli.mjs', events)
    expect(result.hooks!.SessionStart).toHaveLength(1)
    expect(result.hooks!.SessionStart![0].hooks![0].command).toBe('node dist/hook/cli.mjs')
    expect(result.hooks!.SessionStart![0].hooks![0].timeout).toBe(20)
    expect(result.hooks!.Stop).toHaveLength(1)
  })

  it('preserves existing hooks when adding new ones', () => {
    const settings = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'other-hook' }] }],
      },
    }
    const events = { SessionStart: { timeout: 20 } }
    const result = addEvoHooks(settings, 'node dist/hook/cli.mjs', events)
    expect(result.hooks!.SessionStart).toHaveLength(2)
    expect(result.hooks!.SessionStart![0].hooks![0].command).toBe('other-hook')
    expect(result.hooks!.SessionStart![1].hooks![0].command).toBe('node dist/hook/cli.mjs')
  })
})

describe('re-run does not duplicate', () => {
  it('stripEvoHooks + addEvoHooks replaces hooks cleanly', () => {
    const initial = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node /old/path/hook/cli.mjs' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node /old/path/hook/cli.mjs' }] }],
      },
    }
    const events = { SessionStart: { timeout: 20 }, UserPromptSubmit: { timeout: 20 }, Stop: { timeout: 20 } }
    
    const { settings: stripped, removed } = stripEvoHooks(initial)
    expect(removed).toBe(2)
    
    const final = addEvoHooks(stripped, 'node /new/path/hook/cli.mjs', events)
    expect(final.hooks!.SessionStart).toHaveLength(1)
    expect(final.hooks!.SessionStart![0].hooks![0].command).toBe('node /new/path/hook/cli.mjs')
    expect(final.hooks!.UserPromptSubmit).toHaveLength(1)
    expect(final.hooks!.Stop).toHaveLength(1)
  })

  it('multiple re-runs produce the same result', () => {
    const events = { SessionStart: { timeout: 20 } }
    const command = 'node dist/hook/cli.mjs'
    
    let settings = addEvoHooks({}, command, events)
    for (let i = 0; i < 5; i++) {
      const { settings: stripped } = stripEvoHooks(settings)
      settings = addEvoHooks(stripped, command, events)
    }
    
    expect(settings.hooks!.SessionStart).toHaveLength(1)
    expect(countEvoHooks(settings).count).toBe(1)
  })
})

describe('plugin detection', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'evo-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('findClaudePlugin', () => {
    it('finds evo plugin in plugins directory', () => {
      const pluginDir = join(tempDir, 'plugins', 'evo-abc123', '.claude-plugin')
      mkdirSync(pluginDir, { recursive: true })
      writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'evo', version: '0.3.0' }))
      
      const result = findClaudePlugin(tempDir)
      expect(result).toBe(join(tempDir, 'plugins', 'evo-abc123'))
    })

    it('returns null when no evo plugin exists', () => {
      mkdirSync(join(tempDir, 'plugins', 'other-plugin', '.claude-plugin'), { recursive: true })
      writeFileSync(
        join(tempDir, 'plugins', 'other-plugin', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'other', version: '1.0.0' })
      )
      
      expect(findClaudePlugin(tempDir)).toBeNull()
    })

    it('returns null when plugins directory does not exist', () => {
      expect(findClaudePlugin(tempDir)).toBeNull()
    })
  })

  describe('findCodexPlugin', () => {
    it('finds evo plugin in plugins directory', () => {
      const pluginDir = join(tempDir, 'plugins', 'evo-def456', '.codex-plugin')
      mkdirSync(pluginDir, { recursive: true })
      writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'evo', version: '0.3.0' }))
      
      const result = findCodexPlugin(tempDir)
      expect(result).toBe(join(tempDir, 'plugins', 'evo-def456'))
    })

    it('returns null when no evo plugin exists', () => {
      expect(findCodexPlugin(tempDir)).toBeNull()
    })
  })
})

describe('project-level hook detection', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'evo-project-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('findProjectClaudeHooks', () => {
    it('detects evo hooks in .claude/settings.local.json', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })
      writeFileSync(
        join(tempDir, '.claude', 'settings.local.json'),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'node dist/hook/cli.mjs' }] }],
          },
        })
      )
      
      const result = findProjectClaudeHooks(tempDir)
      expect(result.found).toBe(true)
      expect(result.count).toBe(1)
      expect(result.events).toEqual(['SessionStart'])
    })

    it('returns found:false when no project settings exist', () => {
      const result = findProjectClaudeHooks(tempDir)
      expect(result.found).toBe(false)
    })

    it('returns found:false when settings have no evo hooks', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })
      writeFileSync(
        join(tempDir, '.claude', 'settings.local.json'),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'other-hook' }] }],
          },
        })
      )
      
      const result = findProjectClaudeHooks(tempDir)
      expect(result.found).toBe(false)
    })
  })

  describe('findProjectCodexHooks', () => {
    it('detects evo hooks in .codex/hooks.json', () => {
      mkdirSync(join(tempDir, '.codex'), { recursive: true })
      writeFileSync(
        join(tempDir, '.codex', 'hooks.json'),
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: 'node "${PLUGIN_ROOT}/bin/hook.mjs"' }] }],
          },
        })
      )
      
      const result = findProjectCodexHooks(tempDir)
      expect(result.found).toBe(true)
      expect(result.count).toBe(1)
      expect(result.events).toEqual(['Stop'])
    })

    it('detects evo hooks in codex.hooks.json', () => {
      writeFileSync(
        join(tempDir, 'codex.hooks.json'),
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'evo-hook' }] }],
          },
        })
      )
      
      const result = findProjectCodexHooks(tempDir)
      expect(result.found).toBe(true)
      expect(result.count).toBe(1)
    })

    it('returns found:false when no project hooks exist', () => {
      const result = findProjectCodexHooks(tempDir)
      expect(result.found).toBe(false)
    })
  })
})
