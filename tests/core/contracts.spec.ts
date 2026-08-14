import { describe, expect, it } from 'vitest'
import { memoryItemSchema, scopeKey } from '../../src/core/types.js'

describe('memory contracts', () => {
  it('creates an unambiguous hierarchical scope key', () => {
    expect(scopeKey({ type: 'project', id: '/repo', parent: { type: 'user', id: 'alice' } }))
      .toBe('user:alice/project:%2Frepo')
  })

  it('rejects empty memory content', () => {
    expect(() => memoryItemSchema.parse({
      id: 'm1', scope: { type: 'global' }, kind: 'fact', title: 'x', content: '',
      tags: [], usageCount: 0, createdAt: 1, updatedAt: 1,
    })).toThrow()
  })
})
