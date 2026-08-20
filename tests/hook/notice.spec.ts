import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MemoryItem } from '../../src/core/types.js'
import { formatNotice, takeNotice, writeNotice } from '../../src/hook/notice.js'
import { hookConfig, hookOutput, noticeMessage } from '../../src/hook/cli.js'

const item = { id: 'm1' } as MemoryItem
const dir = () => mkdtempSync(join(tmpdir(), 'evo-notice-'))

describe('notice', () => {
  it('round-trips a delta and clears itself after one read', () => {
    const path = dir()
    writeNotice(path, { created: [item, item], updated: [item], deleted: [] })
    expect(takeNotice(path)).toMatchObject({ created: 2, updated: 1 })
    expect(takeNotice(path)).toBeNull()
  })

  it('stays silent when a turn produced nothing', () => {
    const path = dir()
    writeNotice(path, { created: [], updated: [], deleted: [] })
    expect(takeNotice(path)).toBeNull()
    expect(formatNotice(null)).toBeUndefined()
  })

  it('survives a corrupt breadcrumb', () => {
    const path = dir()
    writeFileSync(join(path, 'hook-notice.json'), 'not json')
    expect(takeNotice(path)).toBeNull()
  })

  it('reads as one short line', () => {
    expect(formatNotice({ created: 2, updated: 0, at: 1 })).toBe('evo · remembered 2')
    expect(formatNotice({ created: 0, updated: 3, at: 1 })).toBe('evo · updated 3')
    expect(formatNotice({ created: 1, updated: 1, at: 1 })).toBe('evo · remembered 1, updated 1')
  })
})

describe('hookOutput', () => {
  it('injects recalled context', () => {
    const payload = JSON.parse(hookOutput('# Relevant memory\n- [fact] **A**: b', undefined, { hook_event_name: 'UserPromptSubmit' }))
    expect(payload.hookSpecificOutput).toMatchObject({ hookEventName: 'UserPromptSubmit' })
    expect(payload.hookSpecificOutput.additionalContext).toContain('**A**')
    expect(payload.systemMessage).toBeUndefined()
  })

  it('says nothing at all when there is nothing to recall or report', () => {
    expect(hookOutput('', undefined)).toBe('')
    expect(hookOutput('   ', undefined)).toBe('')
  })

  it('carries a notice without any recalled context', () => {
    expect(JSON.parse(hookOutput('', 'evo · remembered 2'))).toEqual({ systemMessage: 'evo · remembered 2' })
  })
})

describe('noticeMessage', () => {
  const config = { ...hookConfig({}), notify: true }
  const seeded = () => {
    const path = dir()
    writeNotice(path, { created: [item], updated: [], deleted: [] })
    return path
  }

  it('speaks on a prompt turn and consumes the breadcrumb', () => {
    const path = seeded()
    expect(noticeMessage({ hook_event_name: 'UserPromptSubmit' }, config, path)).toBe('evo · remembered 1')
    expect(noticeMessage({ hook_event_name: 'UserPromptSubmit' }, config, path)).toBeUndefined()
  })

  it('leaves the breadcrumb for the next prompt when a session starts', () => {
    const path = seeded()
    expect(noticeMessage({ hook_event_name: 'SessionStart' }, config, path)).toBeUndefined()
    expect(noticeMessage({ hook_event_name: 'UserPromptSubmit' }, config, path)).toBe('evo · remembered 1')
  })

  it('stays silent when notices are switched off', () => {
    const path = seeded()
    expect(noticeMessage({ hook_event_name: 'UserPromptSubmit' }, { ...config, notify: false }, path)).toBeUndefined()
  })
})
