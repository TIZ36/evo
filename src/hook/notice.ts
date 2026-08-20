import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemoryDelta } from '../core/types.js'

/**
 * Reflection runs detached and finishes after the turn is over, so its result
 * has no turn left to report into. It leaves a breadcrumb instead, which the
 * next prompt picks up and clears — evo speaks once, on the next turn, and only
 * when it actually learned something.
 */
export type Notice = { created: number; updated: number; at: number }

const FILE = 'hook-notice.json'

export function writeNotice(dataDir: string, delta: MemoryDelta): void {
  if (!delta.created.length && !delta.updated.length) return
  try {
    writeFileSync(join(dataDir, FILE), JSON.stringify({ created: delta.created.length, updated: delta.updated.length, at: Date.now() } satisfies Notice))
  } catch { /* a missed notice must never break a session */ }
}

/** Reads and consumes the breadcrumb. */
export function takeNotice(dataDir: string): Notice | null {
  const path = join(dataDir, FILE)
  try {
    const notice = JSON.parse(readFileSync(path, 'utf8')) as Notice
    rmSync(path, { force: true })
    return typeof notice.created === 'number' ? notice : null
  } catch {
    return null
  }
}

/** One short line, or nothing at all. */
export function formatNotice(notice: Notice | null): string | undefined {
  if (!notice) return undefined
  const parts: string[] = []
  if (notice.created) parts.push(`remembered ${notice.created}`)
  if (notice.updated) parts.push(`updated ${notice.updated}`)
  return parts.length ? `evo · ${parts.join(', ')}` : undefined
}
