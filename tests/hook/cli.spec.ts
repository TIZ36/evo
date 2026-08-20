import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EvoService } from '../../src/core/evo.js'
import { SqliteMemoryStore } from '../../src/storage/sqlite-store.js'
import { hookConfig, recallContext, reflectTurn } from '../../src/hook/cli.js'

function service() {
  const store = new SqliteMemoryStore(join(mkdtempSync(join(tmpdir(), 'evo-hook-')), 'memory.db'))
  return { store, evo: new EvoService({ store, events: store }) }
}

const config = hookConfig({})

describe('hook config', () => {
  it('defaults to reflecting and importing', () => {
    expect(config).toMatchObject({ recallLimit: 40, maxChars: 6000, reflect: true, importWorkspace: true })
  })

  it('is switched off by the documented variables', () => {
    expect(hookConfig({ EVO_HOOK_REFLECT: '0', EVO_HOOK_IMPORT: '0', EVO_HOOK_RECALL_LIMIT: '5' }))
      .toMatchObject({ reflect: false, importWorkspace: false, recallLimit: 5 })
  })

  it('ignores a non-numeric limit instead of producing NaN', () => {
    expect(hookConfig({ EVO_HOOK_RECALL_LIMIT: 'many' }).recallLimit).toBe(40)
  })
})

describe('recallContext', () => {
  it('renders global and project memory for the event cwd', async () => {
    const { store, evo } = service()
    const cwd = mkdtempSync(join(tmpdir(), 'evo-project-'))
    await evo.remember({ scope: { type: 'global' }, kind: 'preference', title: 'Tone', content: 'Be terse.' })
    await evo.remember({ scope: { type: 'project', id: realpathSync(cwd) }, kind: 'fact', title: 'Stack', content: 'TypeScript and pnpm.' })
    await evo.remember({ scope: { type: 'project', id: '/somewhere/else' }, kind: 'fact', title: 'Other', content: 'Not this project.' })

    const text = await recallContext({ hook_event_name: 'UserPromptSubmit', cwd }, evo, config)
    expect(text).toContain('Be terse.')
    expect(text).toContain('TypeScript and pnpm.')
    expect(text).not.toContain('Not this project.')
    store.close?.()
  })

  it('is empty when nothing is remembered', async () => {
    const { store, evo } = service()
    expect(await recallContext({ cwd: '/nowhere' }, evo, config)).toBe('')
    store.close?.()
  })
})

describe('reflectTurn', () => {
  const transcript = (dir: string) => {
    const path = join(dir, 'transcript.jsonl')
    writeFileSync(path, [
      JSON.stringify({ type: 'user', message: { content: 'always run pnpm check before pushing' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Edit', input: {} }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'added the gate' }] } }),
    ].join('\n'))
    return path
  }

  it('writes the distilled memory into the project scope of the cwd', async () => {
    const { store, evo } = service()
    const dir = mkdtempSync(join(tmpdir(), 'evo-turn-'))
    let seen = ''
    evo.setModelRunner({ complete: async request => { seen = request.prompt; return '{"memories":[{"kind":"constraint","title":"Pre-push gate","content":"Run pnpm check before pushing."}]}' } })

    const delta = await reflectTurn({ session_id: 's1', cwd: dir, transcript_path: transcript(dir) }, evo)
    expect(delta?.created).toHaveLength(1)
    expect(seen).toContain('always run pnpm check before pushing')
    expect(seen).toContain('Edit')
    const items = await evo.recall({ scopes: [{ type: 'project', id: realpathSync(dir) }] })
    expect(items.map(item => item.title)).toEqual(['Pre-push gate'])
    store.close?.()
  })

  it('reads a Codex rollout with the same entry point', async () => {
    const { store, evo } = service()
    const dir = mkdtempSync(join(tmpdir(), 'evo-turn-'))
    const path = join(dir, 'rollout.jsonl')
    writeFileSync(path, [
      JSON.stringify({ type: 'session_meta', payload: { id: 's2' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'always run pnpm check before pushing' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'added the gate' } }),
    ].join('\n'))
    let seen = ''
    evo.setModelRunner({ complete: async request => { seen = request.prompt; return '{"memories":[{"kind":"constraint","title":"Pre-push gate","content":"Run pnpm check before pushing."}]}' } })

    const delta = await reflectTurn({ session_id: 's2', cwd: dir, transcript_path: path }, evo)
    expect(delta?.created).toHaveLength(1)
    expect(seen).toContain('always run pnpm check before pushing')
    expect(seen).toContain('apply_patch')
    store.close?.()
  })

  it('does nothing without a transcript or a usable turn', async () => {
    const { store, evo } = service()
    const dir = mkdtempSync(join(tmpdir(), 'evo-turn-'))
    writeFileSync(join(dir, 'empty.jsonl'), '')
    evo.setModelRunner({ complete: async () => { throw new Error('must not be called') } })
    expect(await reflectTurn({ session_id: 's1' }, evo)).toBeNull()
    expect(await reflectTurn({ session_id: 's1', transcript_path: join(dir, 'empty.jsonl') }, evo)).toBeNull()
    store.close?.()
  })
})
