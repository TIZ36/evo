import type { MemoryScope, ScopeType } from './types.js'

/**
 * Scope tree support: the `/evo/scopes` endpoint and the settings
 * panel's hierarchy view are both built from this module. `scopeKey` already
 * encodes hierarchy (`user:a/project:%2Frepo/session:s1`), so the tree is
 * reconstructed by parsing each stored key and grouping by parent prefix.
 */

export type ScopeTreeNode = {
  key: string
  scope: MemoryScope
  count: number
  children: ScopeTreeNode[]
}

const SCOPE_TYPES: ScopeType[] = ['global', 'user', 'project', 'session', 'conversation']

/** Inverse of `scopeKey`: parse a hierarchical key back into a MemoryScope. */
export function parseScopeKey(key: string): MemoryScope | null {
  if (!key) return null
  const segments = key.split('/')
  let parent: MemoryScope | undefined
  for (const segment of segments) {
    if (segment === 'global') {
      if (parent) return null
      parent = { type: 'global' }
      continue
    }
    const separator = segment.indexOf(':')
    if (separator <= 0) return null
    const type = segment.slice(0, separator) as ScopeType
    if (!SCOPE_TYPES.includes(type)) return null
    const id = decodeURIComponent(segment.slice(separator + 1))
    if (!id) return null
    parent = parent ? { type, id, parent } : { type, id }
  }
  return parent ?? null
}

/** Build a sorted scope tree from scope-key → item-count pairs. */
export function buildScopeTree(counts: Map<string, number>): ScopeTreeNode[] {
  const nodes = new Map<string, ScopeTreeNode>()
  for (const [key, count] of counts) {
    const scope = parseScopeKey(key)
    if (!scope) continue
    nodes.set(key, { key, scope, count, children: [] })
  }
  const roots: ScopeTreeNode[] = []
  for (const [key, node] of nodes) {
    const parentKey = parentScopeKey(key)
    const parent = parentKey === null ? undefined : nodes.get(parentKey)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const rank: Record<string, number> = { global: 0, project: 1, user: 2, session: 3, conversation: 4 }
  const sort = (list: ScopeTreeNode[]) => {
    list.sort((a, b) => (rank[a.scope.type] ?? 9) - (rank[b.scope.type] ?? 9) || a.key.localeCompare(b.key))
    for (const node of list) sort(node.children)
  }
  sort(roots)
  return roots
}

function parentScopeKey(key: string): string | null {
  const index = key.lastIndexOf('/')
  return index < 0 ? null : key.slice(0, index)
}
