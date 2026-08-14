import { describe, expect, it } from 'vitest'
import { resolveDataPaths } from '../../src/config/paths.js'

describe('data paths', () => {
  it('prefers explicit database path', () => {
    expect(resolveDataPaths({ databasePath: '/tmp/custom.db' }, { platform: 'linux', home: '/home/a', env: {} }).databasePath)
      .toBe('/tmp/custom.db')
  })

  it('uses EVO_MEMORY_DATA_DIR before platform default', () => {
    expect(resolveDataPaths({}, { platform: 'linux', home: '/home/a', env: { EVO_MEMORY_DATA_DIR: '/data/evo' } }).databasePath)
      .toBe('/data/evo/memory.db')
  })

  it('uses the platform application data directory by default', () => {
    expect(resolveDataPaths({}, { platform: 'darwin', home: '/Users/a', env: {} }).databasePath)
      .toBe('/Users/a/Library/Application Support/evo-memory/memory.db')
  })
})
