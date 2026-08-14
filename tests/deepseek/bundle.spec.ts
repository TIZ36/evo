import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')

describe('DeepSeek profile bundle', () => {
  it('declares the profile patch as a published DSH bundle', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('install_evo_dsps.sh')
  })

  it('inserts the memory service before its DeepSeek adapter', () => {
    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch.indexOf('id: evo-memory\n')).toBeLessThan(patch.indexOf('id: evo-memory-deepseek'))
    expect(patch).toContain("EVO_MEMORY_PROVIDER")
    expect(patch).toContain("EVO_MEMORY_MODEL")
  })
})
