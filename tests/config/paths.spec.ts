import { describe, expect, it } from 'vitest'
import { resolveDataPaths } from '../../src/config/paths.js'

const never = () => false

describe('data paths', () => {
  it('prefers explicit database path', () => {
    expect(resolveDataPaths({ databasePath: '/tmp/custom.db' }, { platform: 'linux', home: '/home/a', env: {}, exists: never }).databasePath)
      .toBe('/tmp/custom.db')
  })

  it('uses EVO_DATA_DIR before platform default', () => {
    expect(resolveDataPaths({}, { platform: 'linux', home: '/home/a', env: { EVO_DATA_DIR: '/data/evo' }, exists: never }).databasePath)
      .toBe('/data/evo/memory.db')
  })

  it('still honours the pre-rename EVO_MEMORY_DATA_DIR', () => {
    expect(resolveDataPaths({}, { platform: 'linux', home: '/home/a', env: { EVO_MEMORY_DATA_DIR: '/data/old' }, exists: never }).databasePath)
      .toBe('/data/old/memory.db')
  })

  it('prefers EVO_DATA_DIR over the legacy variable', () => {
    expect(resolveDataPaths({}, {
      platform: 'linux',
      home: '/home/a',
      env: { EVO_DATA_DIR: '/data/evo', EVO_MEMORY_DATA_DIR: '/data/old' },
      exists: never,
    }).databasePath).toBe('/data/evo/memory.db')
  })

  it('uses the platform application data directory by default', () => {
    expect(resolveDataPaths({}, { platform: 'darwin', home: '/Users/a', env: {}, exists: never }).databasePath)
      .toBe('/Users/a/Library/Application Support/evo/memory.db')
  })

  it('adopts the pre-rename platform directory when it holds the database', () => {
    const exists = (path: string) => path === '/home/a/.local/share/evo-memory/memory.db'
    expect(resolveDataPaths({}, { platform: 'linux', home: '/home/a', env: {}, exists }).databasePath)
      .toBe('/home/a/.local/share/evo-memory/memory.db')
  })

  it('keeps the new directory once it holds the database', () => {
    const exists = (path: string) => path.includes('/share/evo/')
    expect(resolveDataPaths({}, { platform: 'linux', home: '/home/a', env: {}, exists }).databasePath)
      .toBe('/home/a/.local/share/evo/memory.db')
  })
})
