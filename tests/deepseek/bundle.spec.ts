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

  it('declares the web client half discoverable by dsh-client-modules', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(manifest.dsh.client).toMatchObject({ platform: 'web' })
    expect(manifest.exports['./client']).toMatchObject({ default: './dist/client.js' })
    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch.indexOf('id: evo-memory-web')).toBeGreaterThan(patch.indexOf('id: evo-memory-deepseek'))
    expect(patch).toMatch(/name: evo-memory\n/)
  })
})

describe('web client bundle', () => {
  it('is a ModuleLoader factory registering the evo-memory entry', () => {
    const client = readFileSync(join(root, 'src/client/client.js'), 'utf8')
    expect(client).toContain('window.__ModuleLoader__.load({')
    expect(client).toContain("id: 'evo-memory'")
    expect(client).toContain("settings.section")
    expect(client).toContain("exports.inject = ['slots']")
  })
})
