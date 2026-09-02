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
    expect(patch.indexOf('id: evo\n')).toBeLessThan(patch.indexOf('id: evo-deepseek'))
    expect(patch).toContain("EVO_PROVIDER")
    expect(patch).toContain("EVO_MODEL")
  })

  it('declares the web client half discoverable by dsh-client-modules', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(manifest.dsh.client).toMatchObject({ platform: 'web' })
    expect(manifest.exports['./client']).toMatchObject({ default: './dist/client.js' })
    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch.indexOf('id: evo-web')).toBeGreaterThan(patch.indexOf('id: evo-deepseek'))
    // The carrier row is named by the package itself: dsh-client-modules keys the
    // client graph row on the resolved package name, so any drift from the
    // published name makes the bundle unreachable.
    expect(patch).toContain(`name: "${manifest.name}"\n`)
    expect(patch).toContain(`name: "${manifest.name}/cordis"`)
    expect(patch).toContain(`name: "${manifest.name}/deepseek"`)
  })
})

describe('web client bundle', () => {
  it('is a ModuleLoader factory registering under the package name', () => {
    const client = readFileSync(join(root, 'src/client/client.js'), 'utf8')
    const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(client).toContain('window.__ModuleLoader__.load({')
    // dsh-client-modules rejects a bundle whose registration id is not the
    // package name it resolved the row from.
    expect(client).toContain(`id: '${name}'`)
    expect(client).toContain("settings.section")
    expect(client).toContain("exports.inject = ['slots']")
  })
})
