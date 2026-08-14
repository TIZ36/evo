import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')

describe('iron rule: no company or sensitive information', () => {
  it('keeps the source tree free of forbidden patterns', () => {
    const output = execFileSync(process.execPath, ['scripts/iron-rule.mjs', '--source-only'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(output).toContain('[iron-rule] 通过')
  })
})
