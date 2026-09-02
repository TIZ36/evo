import { describe, expect, it } from 'vitest'
import { renderMemoryContext } from '../../src/core/prompt.js'
import type { MemoryItem, MemoryScope } from '../../src/core/types.js'

const scope: MemoryScope = { type: 'project', id: '/repo' }
const memory = (id: string, content: string, overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id, scope, kind: 'fact', title: id, content, tags: [],
  usageCount: 0, createdAt: 1, updatedAt: 1, ...overrides,
})
const importedFile = (id: string, content: string, path = `/repo/${id}`): MemoryItem =>
  memory(id, content, { source: { runtime: 'workspace-import', path } })

describe('renderMemoryContext', () => {
  it('skips a row too large for the budget and keeps rendering the rest', () => {
    const output = renderMemoryContext([
      memory('huge', 'x'.repeat(500)),
      memory('small', 'still useful'),
    ], [], 200)
    expect(output).not.toContain('huge')
    expect(output).toContain('**small**: still useful')
  })

  it('quotes an imported file in excerpt, pointing at the file for the rest', () => {
    const output = renderMemoryContext([importedFile('CLAUDE.md', 'y'.repeat(5000))], [], 6000)
    expect(output).toContain('read `/repo/CLAUDE.md` for the rest')
    // The excerpt is bounded well under the budget the whole body would have eaten.
    expect(output.length).toBeLessThan(600)
  })

  it('leaves a distilled memory whole, however close to the cap', () => {
    const content = 'z'.repeat(1200)
    expect(renderMemoryContext([memory('own', content)], [], 6000)).toContain(content)
  })

  it('renders no heading when every row was skipped', () => {
    expect(renderMemoryContext([memory('huge', 'x'.repeat(500))], [], 200)).toBe('')
  })

  it('still lists skills when the memories were all skipped', () => {
    const output = renderMemoryContext(
      [memory('huge', 'x'.repeat(500))],
      [{ name: 'build', trigger: 'when building', path: '.claude/skills/build/SKILL.md' }],
      200,
    )
    expect(output).toContain('# Available skills')
    expect(output).toContain('**build**')
  })
})
