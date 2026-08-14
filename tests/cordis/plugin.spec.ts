import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../../src/cordis/index.js'

describe('Cordis plugin', () => {
  it('registers evoMemory and removes it on disposal', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { databasePath: join(mkdtempSync(join(tmpdir(), 'evo-cordis-')), 'memory.db') })
    expect(ctx.evoMemory).toBeDefined()
    await ctx.evoMemory.remember({ scope: { type: 'global' }, kind: 'fact', title: 'x', content: 'y' })
    expect(await ctx.evoMemory.recall()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.evoMemory).toBeUndefined()
  })
})
