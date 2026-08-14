import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import * as memoryPlugin from '../../src/cordis/index.js'
import * as deepseekPlugin from '../../src/deepseek/index.js'

describe('DeepSeek Harness loader composition', () => {
  it('loads beside real Harness llm and systemPrompt services', async () => {
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    const prompt = await ctx.plugin(SystemPrompt, {})
    const memory = await ctx.plugin(memoryPlugin, { databasePath: join(mkdtempSync(join(tmpdir(), 'evo-loader-')), 'memory.db') })
    const adapter = await ctx.plugin(deepseekPlugin, { provider: 'deepseek', model: 'deepseek-chat', reflect: false })
    expect(ctx.evoMemory).toBeDefined()
    expect((await ctx.systemPrompt.assemble()).contexts).toEqual([])
    await adapter.dispose(); await memory.dispose(); await prompt.dispose(); await llm.dispose()
  })
})
