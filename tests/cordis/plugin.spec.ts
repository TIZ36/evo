import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../../src/cordis/index.js'

describe('Cordis plugin', () => {
  it('registers evo and removes it on disposal', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { databasePath: join(mkdtempSync(join(tmpdir(), 'evo-cordis-')), 'memory.db') })
    expect(ctx.evo).toBeDefined()
    await ctx.evo.remember({ scope: { type: 'global' }, kind: 'fact', title: 'x', content: 'y' })
    expect(await ctx.evo.recall()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.evo).toBeUndefined()
  })
})
