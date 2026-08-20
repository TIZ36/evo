import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { canonicalPath, hookScopes, projectScope } from '../../src/hook/scope.js'

describe('hook scopes', () => {
  it('canonicalises a real path', () => {
    const dir = mkdtempSync(`${tmpdir()}/evo-scope-`)
    // On macOS tmpdir() is a symlink, so the raw path and the canonical one differ.
    expect(canonicalPath(dir)).toBe(realpathSync(dir))
    expect(projectScope(dir).id).toBe(realpathSync(dir))
  })

  it('keeps a path that cannot be resolved', () => {
    expect(canonicalPath('/definitely/not/here')).toBe('/definitely/not/here')
  })

  it('recalls global alone without a cwd', () => {
    expect(hookScopes()).toEqual([{ type: 'global' }])
    expect(hookScopes('  ')).toEqual([{ type: 'global' }])
  })
})
