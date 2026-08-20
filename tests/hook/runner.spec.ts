import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexCliModelRunner } from '../../src/hook/runner.js'

/**
 * A stand-in for `codex exec` with the one behaviour that matters here: it
 * drains stdin before answering, exactly as Codex does when it looks for input
 * to append to the prompt. A runner that leaves stdin open never gets an
 * answer out of it.
 */
function fakeCodex(): string {
  const dir = mkdtempSync(join(tmpdir(), 'evo-fake-codex-'))
  const path = join(dir, 'codex')
  writeFileSync(path, [
    '#!/bin/sh',
    'cat >/dev/null',
    'while [ $# -gt 0 ]; do',
    '  [ "$1" = "--output-last-message" ] && out="$2"',
    '  [ "$1" = "--model" ] && printf "%s" "$2" > "$(dirname "$0")/model"',
    '  shift',
    'done',
    'printf \'{"memories":[]}\' > "$out"',
  ].join('\n'))
  chmodSync(path, 0o755)
  return path
}

describe('CodexCliModelRunner', () => {
  it('closes stdin, so the CLI stops waiting for input it will never get', async () => {
    const runner = new CodexCliModelRunner({ command: fakeCodex(), timeoutMs: 10_000 })
    expect(await runner.complete({ purpose: 'reflect', prompt: 'distil this turn' })).toBe('{"memories":[]}')
  })

  it('reports a failing CLI instead of returning nothing', async () => {
    const runner = new CodexCliModelRunner({ command: 'evo-no-such-codex', timeoutMs: 10_000 })
    await expect(runner.complete({ purpose: 'reflect', prompt: 'x' })).rejects.toThrow(/reflect failed/)
  })
})
