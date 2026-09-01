import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import * as evoPlugin from '../../src/cordis/index.js'
import * as deepseekPlugin from '../../src/deepseek/index.js'

describe('workspace import trigger', () => {
  it('auto-imports project files on the first prompt assembly', async () => {
    const cwd = join(mkdtempSync(join(tmpdir(), 'evo-trigger-')), 'project')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Rules\n\nBe concise')
    writeFileSync(join(cwd, 'AGENTS.md'), 'Lint before commit')

    const ctx = new Context()
    ctx.provide('llm', { stream: async function* () {} })
    ctx.provide('systemPrompt', {})
    const fiberService = await ctx.plugin(evoPlugin, { databasePath: join(cwd, '..', 'memory.db') })
    const fiberAdapter = await ctx.plugin(deepseekPlugin, { provider: 'x', model: 'y', reflect: false, workspaceImport: true })

    const session = Session.create('s1' as never, [], { version: SESSION_FORMAT_VERSION, id: 's1', createdAt: 1, cwd } as never)
    const assembly = { sections: [], contexts: [], tools: [], variables: {} } as PromptAssembly
    const assembleContext = { agent: { session } } as unknown as AssembleContext
    await ctx.waterfall('system-prompt/assemble', assembly, assembleContext, () => Promise.resolve(assembly))

    const items = await ctx.evo.recall({ scopes: [{ type: 'project', id: cwd }] })
    expect(items).toHaveLength(2)
    expect(items.some(item => item.title === 'CLAUDE.md' && item.kind === 'fact')).toBe(true)
    expect(items.some(item => item.title === 'AGENTS.md' && item.kind === 'constraint')).toBe(true)

    await fiberAdapter.dispose()
    await fiberService.dispose()
  })

  it('does not import when workspaceImport is disabled', async () => {
    const cwd = join(mkdtempSync(join(tmpdir(), 'evo-trigger-')), 'project')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Rules')

    const ctx = new Context()
    ctx.provide('llm', { stream: async function* () {} })
    ctx.provide('systemPrompt', {})
    const fiberService = await ctx.plugin(evoPlugin, { databasePath: join(cwd, '..', 'memory.db') })
    const fiberAdapter = await ctx.plugin(deepseekPlugin, { provider: 'x', model: 'y', reflect: false, workspaceImport: false })

    const session = Session.create('s2' as never, [], { version: SESSION_FORMAT_VERSION, id: 's2', createdAt: 1, cwd } as never)
    const assembly = { sections: [], contexts: [], tools: [], variables: {} } as PromptAssembly
    const assembleContext = { agent: { session } } as unknown as AssembleContext
    await ctx.waterfall('system-prompt/assemble', assembly, assembleContext, () => Promise.resolve(assembly))

    expect(await ctx.evo.recall({ scopes: [{ type: 'project', id: cwd }] })).toHaveLength(0)

    await fiberAdapter.dispose()
    await fiberService.dispose()
  })

  it('assemble includes project disk SKILL.md files in context', async () => {
    const cwd = join(mkdtempSync(join(tmpdir(), 'evo-skill-ctx-')), 'project')
    mkdirSync(cwd, { recursive: true })
    mkdirSync(join(cwd, '.claude/skills/my-build-skill'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/my-build-skill/SKILL.md'), `# Build Skill

## Purpose

Build the project.

## When to use

When you need to build the project.

## Steps

1. Run npm build

## Verification

Check dist folder exists.
`)

    const ctx = new Context()
    ctx.provide('llm', { stream: async function* () {} })
    ctx.provide('systemPrompt', {})
    const fiberService = await ctx.plugin(evoPlugin, { databasePath: join(cwd, '..', 'memory.db') })
    const fiberAdapter = await ctx.plugin(deepseekPlugin, { provider: 'x', model: 'y', reflect: false, workspaceImport: true })

    const session = Session.create('s3' as never, [], { version: SESSION_FORMAT_VERSION, id: 's3', createdAt: 1, cwd } as never)
    const assembly = { sections: [], contexts: [], tools: [], variables: {} } as PromptAssembly
    const assembleContext = { agent: { session } } as unknown as AssembleContext
    const result = await ctx.waterfall('system-prompt/assemble', assembly, assembleContext, () => Promise.resolve(assembly))

    const evoContext = result.contexts.find(c => c.name === 'evo')
    expect(evoContext).toBeDefined()
    expect(evoContext!.text).toContain('my-build-skill')
    expect(evoContext!.text).toContain('.claude/skills/my-build-skill/SKILL.md')

    await fiberAdapter.dispose()
    await fiberService.dispose()
  })
})
