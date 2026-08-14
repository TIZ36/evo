import { describe, expect, it } from 'vitest'
import { parseModelJson } from '../../src/core/json-model.js'

describe('parseModelJson', () => {
  it('extracts JSON from a fenced model response', () => {
    expect(parseModelJson<{ ok: boolean }>('text\n```json\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('rejects responses without an object or array', () => {
    expect(() => parseModelJson('nothing useful')).toThrow('valid JSON')
  })
})
