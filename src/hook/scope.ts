import { realpathSync } from 'node:fs'
import type { MemoryScope } from '../core/types.js'

/**
 * Claude Code reports `cwd` through the platform's real path (`/tmp` arrives as
 * `/private/tmp` on macOS). Scope ids are compared as strings, so every path
 * that becomes a scope id has to be canonicalised the same way or a project
 * silently recalls nothing.
 */
export function canonicalPath(path: string): string {
  try { return realpathSync(path) } catch { return path }
}

export function projectScope(cwd: string): MemoryScope {
  return { type: 'project', id: canonicalPath(cwd) }
}

/** Scopes recalled for a hook event: global always, project when there is a cwd. */
export function hookScopes(cwd?: string): MemoryScope[] {
  const scopes: MemoryScope[] = [{ type: 'global' }]
  if (cwd?.trim()) scopes.push(projectScope(cwd))
  return scopes
}
