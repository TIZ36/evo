import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EvoService } from '../../src/core/evo.js'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { buildCatalog, hookConfig, recallContext, reflectTurn } from '../../src/hook/cli.js'

function service() {
  const store = new SqliteMemoryStore(join(mkdtempSync(join(tmpdir(), 'evo-hook-')), 'memory.db'))
  return { store, evo: new EvoService({ store, skillStore: store, events: store }) }
}

const config = hookConfig({})

describe('hook config', () => {
  it('defaults to reflecting and importing', () => {
    expect(config).toMatchObject({ recallLimit: 40, maxChars: 6000, reflect: true, importWorkspace: true, includeGlobalSkills: true })
  })

  it('is switched off by the documented variables', () => {
    expect(hookConfig({ EVO_HOOK_REFLECT: '0', EVO_HOOK_IMPORT: '0', EVO_HOOK_RECALL_LIMIT: '5' }))
      .toMatchObject({ reflect: false, importWorkspace: false, recallLimit: 5 })
  })

  it('ignores a non-numeric limit instead of producing NaN', () => {
    expect(hookConfig({ EVO_HOOK_RECALL_LIMIT: 'many' }).recallLimit).toBe(40)
  })

  it('disables global skills with EVO_HOOK_GLOBAL_SKILLS=0', () => {
    expect(hookConfig({ EVO_HOOK_GLOBAL_SKILLS: '0' }).includeGlobalSkills).toBe(false)
    expect(hookConfig({ EVO_HOOK_GLOBAL_SKILLS: '1' }).includeGlobalSkills).toBe(true)
  })
})

describe('recallContext', () => {
  it('renders global and project memory for the event cwd', async () => {
    const { store, evo } = service()
    const cwd = mkdtempSync(join(tmpdir(), 'evo-project-'))
    await evo.remember({ scope: { type: 'global' }, kind: 'preference', title: 'Tone', content: 'Be terse.' })
    await evo.remember({ scope: { type: 'project', id: realpathSync(cwd) }, kind: 'fact', title: 'Stack', content: 'TypeScript and pnpm.' })
    await evo.remember({ scope: { type: 'project', id: '/somewhere/else' }, kind: 'fact', title: 'Other', content: 'Not this project.' })

    const text = await recallContext({ hook_event_name: 'UserPromptSubmit', cwd }, evo, config)
    expect(text).toContain('Be terse.')
    expect(text).toContain('TypeScript and pnpm.')
    expect(text).not.toContain('Not this project.')
    store.close?.()
  })

  it('is empty when nothing is remembered', async () => {
    const { store, evo } = service()
    const noGlobalConfig = hookConfig({ EVO_HOOK_GLOBAL_SKILLS: '0' })
    expect(await recallContext({ cwd: '/nowhere' }, evo, noGlobalConfig)).toBe('')
    store.close?.()
  })
})

describe('recallContext disk skills', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'evo-hook-skills-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('includes project disk skills with Chinese/Unicode names', async () => {
    const { store, evo } = service()
    mkdirSync(join(cwd, '.claude/skills/素材链路拆解分析'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/素材链路拆解分析/SKILL.md'), `# 素材链路拆解

## Purpose

分析广告素材的完整链路。

## When to use

当需要分析素材效果时使用。

## Steps

1. 收集素材数据
2. 分析链路节点
3. 输出分析报告

## Verification

报告生成成功。
`)
    const noGlobalConfig = hookConfig({ EVO_HOOK_GLOBAL_SKILLS: '0' })
    const text = await recallContext({ hook_event_name: 'UserPromptSubmit', cwd }, evo, noGlobalConfig)
    expect(text).toContain('素材链路拆解分析')
    expect(text).toContain('.claude/skills/素材链路拆解分析/SKILL.md')
    expect(text).toContain('当需要分析素材效果')
    store.close?.()
  })

  it('includes incomplete SKILL.md with real paths', async () => {
    const { store, evo } = service()
    mkdirSync(join(cwd, '.claude/skills/quick-tip'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/quick-tip/SKILL.md'), `# Quick Notes

When working with JSON files, use jq to parse them.

This is a simple guide for JSON handling.`)

    const noGlobalConfig = hookConfig({ EVO_HOOK_GLOBAL_SKILLS: '0' })
    const text = await recallContext({ hook_event_name: 'UserPromptSubmit', cwd }, evo, noGlobalConfig)
    expect(text).toContain('quick-tip')
    expect(text).toContain('.claude/skills/quick-tip/SKILL.md')
    expect(text).toContain('jq')
    store.close?.()
  })

  it('includes skills from multiple skill directories', async () => {
    const { store, evo } = service()
    mkdirSync(join(cwd, '.claude/skills/skill-a'), { recursive: true })
    mkdirSync(join(cwd, '.codex/skills/skill-b'), { recursive: true })
    mkdirSync(join(cwd, '.paper/agents/skills/skill-c'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/skill-a/SKILL.md'), '# A\n\n## When to use\n\nFor A tasks.')
    writeFileSync(join(cwd, '.codex/skills/skill-b/SKILL.md'), '# B\n\n## When to use\n\nFor B tasks.')
    writeFileSync(join(cwd, '.paper/agents/skills/skill-c/SKILL.md'), '# C\n\n## When to use\n\nFor C tasks.')

    const noGlobalConfig = hookConfig({ EVO_HOOK_GLOBAL_SKILLS: '0' })
    const text = await recallContext({ hook_event_name: 'UserPromptSubmit', cwd }, evo, noGlobalConfig)
    expect(text).toContain('skill-a')
    expect(text).toContain('.claude/skills/skill-a/SKILL.md')
    expect(text).toContain('skill-b')
    expect(text).toContain('.codex/skills/skill-b/SKILL.md')
    expect(text).toContain('skill-c')
    expect(text).toContain('.paper/agents/skills/skill-c/SKILL.md')
    store.close?.()
  })

  it('does not invent project disk skills without cwd', async () => {
    const { store, evo } = service()
    mkdirSync(join(cwd, '.claude/skills/test-skill'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/test-skill/SKILL.md'), '# Test\n\n## When to use\n\nFor testing.')

    const noGlobalConfig = hookConfig({ EVO_HOOK_GLOBAL_SKILLS: '0' })
    const text = await recallContext({ hook_event_name: 'UserPromptSubmit' }, evo, noGlobalConfig)
    expect(text).toBe('')
    expect(text).not.toContain('test-skill')
    store.close?.()
  })

  it('deduplicates skills by (scope, path) not name-only', async () => {
    const { store, evo } = service()
    mkdirSync(join(cwd, '.claude/skills/build'), { recursive: true })
    mkdirSync(join(cwd, '.codex/skills/build'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/build/SKILL.md'), '# Build (Claude)\n\n## When to use\n\nClaude build.')
    writeFileSync(join(cwd, '.codex/skills/build/SKILL.md'), '# Build (Codex)\n\n## When to use\n\nCodex build.')

    const noGlobalConfig = hookConfig({ EVO_HOOK_GLOBAL_SKILLS: '0' })
    const text = await recallContext({ hook_event_name: 'UserPromptSubmit', cwd }, evo, noGlobalConfig)
    expect(text).toContain('.claude/skills/build/SKILL.md')
    expect(text).toContain('.codex/skills/build/SKILL.md')
    const buildMatches = text.match(/\*\*build\*\*/gi)
    expect(buildMatches).toHaveLength(2)
    store.close?.()
  })
})

describe('reflectTurn', () => {
  const transcript = (dir: string) => {
    const path = join(dir, 'transcript.jsonl')
    writeFileSync(path, [
      JSON.stringify({ type: 'user', message: { content: 'always run pnpm check before pushing' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Edit', input: {} }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'added the gate' }] } }),
    ].join('\n'))
    return path
  }

  it('writes the distilled memory into the project scope of the cwd', async () => {
    const { store, evo } = service()
    const dir = mkdtempSync(join(tmpdir(), 'evo-turn-'))
    let seen = ''
    evo.setModelRunner({ complete: async request => { seen = request.prompt; return '{"memories":[{"kind":"constraint","title":"Pre-push gate","content":"Run pnpm check before pushing."}]}' } })

    const delta = await reflectTurn({ session_id: 's1', cwd: dir, transcript_path: transcript(dir) }, evo)
    expect(delta?.created).toHaveLength(1)
    expect(seen).toContain('always run pnpm check before pushing')
    expect(seen).toContain('Edit')
    const items = await evo.recall({ scopes: [{ type: 'project', id: realpathSync(dir) }] })
    expect(items.map(item => item.title)).toEqual(['Pre-push gate'])
    store.close?.()
  })

  it('reads a Codex rollout with the same entry point', async () => {
    const { store, evo } = service()
    const dir = mkdtempSync(join(tmpdir(), 'evo-turn-'))
    const path = join(dir, 'rollout.jsonl')
    writeFileSync(path, [
      JSON.stringify({ type: 'session_meta', payload: { id: 's2' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'always run pnpm check before pushing' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'added the gate' } }),
    ].join('\n'))
    let seen = ''
    evo.setModelRunner({ complete: async request => { seen = request.prompt; return '{"memories":[{"kind":"constraint","title":"Pre-push gate","content":"Run pnpm check before pushing."}]}' } })

    const delta = await reflectTurn({ session_id: 's2', cwd: dir, transcript_path: path }, evo)
    expect(delta?.created).toHaveLength(1)
    expect(seen).toContain('always run pnpm check before pushing')
    expect(seen).toContain('apply_patch')
    store.close?.()
  })

  it('does nothing without a transcript or a usable turn', async () => {
    const { store, evo } = service()
    const dir = mkdtempSync(join(tmpdir(), 'evo-turn-'))
    writeFileSync(join(dir, 'empty.jsonl'), '')
    evo.setModelRunner({ complete: async () => { throw new Error('must not be called') } })
    expect(await reflectTurn({ session_id: 's1' }, evo)).toBeNull()
    expect(await reflectTurn({ session_id: 's1', transcript_path: join(dir, 'empty.jsonl') }, evo)).toBeNull()
    store.close?.()
  })
})

describe('buildCatalog', () => {
  it('returns empty catalog when nothing is stored', async () => {
    const { store, evo } = service()
    const result = await buildCatalog(evo, store, undefined, false)
    expect(result.skills).toHaveLength(0)
    expect(result.memories).toHaveLength(0)
    store.close?.()
  })

  it('includes global and project memories', async () => {
    const { store, evo } = service()
    const cwd = mkdtempSync(join(tmpdir(), 'evo-project-'))
    await evo.remember({ scope: { type: 'global' }, kind: 'fact', title: 'Global fact', content: 'Global content' })
    await evo.remember({ scope: { type: 'project', id: realpathSync(cwd) }, kind: 'preference', title: 'Project pref', content: 'Project content' })

    const result = await buildCatalog(evo, store, cwd, false)
    expect(result.memories).toHaveLength(2)
    const titles = result.memories.map(m => m.name).sort()
    expect(titles).toEqual(['Global fact', 'Project pref'])
    store.close?.()
  })

  it('includes database skills and disk-discovered skills', async () => {
    const { store, evo } = service()
    const cwd = mkdtempSync(join(tmpdir(), 'evo-project-'))

    await store.putSkill({
      name: 'db-skill',
      scope: { type: 'global' },
      body: { purpose: 'P', trigger: 'T', steps: '1. S', check: 'C' },
      usageCount: 5,
      createdAt: 1000,
      updatedAt: 1000,
      dormant: false,
      promoted: true,
    })

    mkdirSync(join(cwd, '.claude/skills/disk-skill'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/disk-skill/SKILL.md'), `# Disk Skill

## Purpose

Disk skill purpose.

## When to use

When testing disk discovery.

## Steps

1. Do the thing

## Verification

Check it worked.
`)

    const result = await buildCatalog(evo, store, cwd, false)
    expect(result.skills.length).toBeGreaterThanOrEqual(2)
    const names = result.skills.map(s => s.name)
    expect(names).toContain('db-skill')
    expect(names).toContain('disk-skill')
    store.close?.()
  })

  it('includes skills with Chinese/Unicode names from disk', async () => {
    const { store, evo } = service()
    const cwd = mkdtempSync(join(tmpdir(), 'evo-project-'))

    mkdirSync(join(cwd, '.claude/skills/素材分析'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/素材分析/SKILL.md'), '# 素材分析\n\n分析广告素材效果')

    const result = await buildCatalog(evo, store, cwd, false)
    const names = result.skills.map(s => s.name)
    expect(names).toContain('素材分析')
    store.close?.()
  })
})
