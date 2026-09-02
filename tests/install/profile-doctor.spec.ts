import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const CANONICAL = '@tiz36/evo'

type Manifest = { dependencies?: Record<string, string>; dsh?: unknown }

/** Build a throwaway profile: a manifest plus whatever node_modules it claims. */
function profile(manifest: Manifest, installed: Record<string, { name: string } | null> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'evo-profile-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  for (const [name, pkg] of Object.entries(installed)) {
    if (pkg === null) continue // a dangling link: declared, resolves to nothing
    const target = join(dir, 'node_modules', name)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'package.json'), JSON.stringify(pkg))
  }
  return dir
}

/** Run the doctor exactly as the installer does. */
function doctor(dir: string): { stale: string[]; warnings: string } {
  const run = spawnSync(
    process.execPath,
    ['scripts/profile-doctor.mjs', join(dir, 'package.json'), dir, CANONICAL],
    { cwd: root, encoding: 'utf8' },
  )
  expect(run.status).toBe(0)
  return { stale: run.stdout.split('\n').filter(Boolean), warnings: run.stderr }
}

describe('profile doctor', () => {
  it('reports an alias that resolves to evo', () => {
    const dir = profile(
      { dependencies: { [CANONICAL]: 'link:/checkout', evo: 'link:/checkout' } },
      { [CANONICAL]: { name: CANONICAL }, evo: { name: CANONICAL } },
    )
    expect(doctor(dir).stale).toEqual(['evo'])
  })

  it('reports a former name left dangling by a checkout that moved', () => {
    const dir = profile(
      { dependencies: { [CANONICAL]: 'link:/checkout', 'evo-memory': 'link:/gone' } },
      { [CANONICAL]: { name: CANONICAL }, 'evo-memory': null },
    )
    expect(doctor(dir).stale).toEqual(['evo-memory'])
  })

  it('leaves a name that resolves to somebody else, and says so', () => {
    // `evo` is a real name on the registry. Removing a dependency the user
    // meant to install would be worse than the duplication we are chasing.
    const dir = profile(
      { dependencies: { [CANONICAL]: 'link:/checkout', evo: '^1.0.0' } },
      { [CANONICAL]: { name: CANONICAL }, evo: { name: 'evo' } },
    )
    const { stale, warnings } = doctor(dir)
    expect(stale).toEqual([])
    expect(warnings).toContain('leaving "evo" alone')
  })

  it('never reports the canonical name itself', () => {
    const dir = profile({ dependencies: { [CANONICAL]: 'link:/checkout' } }, { [CANONICAL]: { name: CANONICAL } })
    expect(doctor(dir).stale).toEqual([])
  })

  it('leaves an unrelated dangling dependency alone', () => {
    const dir = profile(
      { dependencies: { [CANONICAL]: 'link:/checkout', 'some-other-plugin': 'link:/gone' } },
      { [CANONICAL]: { name: CANONICAL }, 'some-other-plugin': null },
    )
    expect(doctor(dir).stale).toEqual([])
  })

  it('reports every alias when a profile accumulated several', () => {
    const dir = profile(
      { dependencies: { [CANONICAL]: 'link:/checkout', evo: 'link:/checkout', 'evo-memory': 'link:/gone' } },
      { [CANONICAL]: { name: CANONICAL }, evo: { name: CANONICAL }, 'evo-memory': null },
    )
    expect(doctor(dir).stale.sort()).toEqual(['evo', 'evo-memory'])
  })
})
