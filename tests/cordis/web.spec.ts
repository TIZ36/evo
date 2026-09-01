import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../../src/cordis/index.js'
import { createMemoryApiHandler, LEGACY_MEMORY_API_PATH, MEMORY_API_PATH } from '../../src/cordis/web.js'
import type { EvoCordisService } from '../../src/cordis/service.js'

class FakeResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status
    this.headers = headers
  }
  end(text: string) { this.body = text }
}

function fakeRequest(method: string, url: string, body?: unknown) {
  const req = { method, url } as never
  ;(req as { [Symbol.asyncIterator]: unknown })[Symbol.asyncIterator] = async function* () {
    if (body !== undefined) yield Buffer.from(JSON.stringify(body))
  }
  return req
}

async function call(service: EvoCordisService, method: string, url: string, body?: unknown) {
  const handler = createMemoryApiHandler(service)
  const res = new FakeResponse()
  await handler(fakeRequest(method, url, body) as never, res as never)
  return { status: res.status, json: res.body ? JSON.parse(res.body) as Record<string, unknown> : null }
}

async function service() {
  const ctx = new Context()
  const dbPath = join(mkdtempSync(join(tmpdir(), 'evo-web-')), 'memory.db')
  const fiber = await ctx.plugin(plugin, { databasePath: dbPath })
  return { ctx, fiber, dbPath, svc: ctx.evo }
}

describe('evo HTTP API', () => {
  it('serves status, memories, and single-memory reads', async () => {
    const { fiber, svc } = await service()
    try {
      await svc.remember({ scope: { type: 'project', id: '/repo' }, kind: 'fact', title: 'API', content: 'works' })
      await svc.remember({ scope: { type: 'project', id: '/repo' }, kind: 'skill', title: 'Other', content: 'ignored by kind filter' })
      const status = await call(svc, 'GET', `${MEMORY_API_PATH}/status`)
      expect(status.status).toBe(200)
      expect(status.json).toMatchObject({ ok: true, busy: false })
      const list = await call(svc, 'GET', `${MEMORY_API_PATH}/memories?scopeType=project&scopeId=%2Frepo&kind=fact&limit=10`)
      expect(list.status).toBe(200)
      const items = (list.json as { items: { id: string; kind: string }[] }).items
      expect(items).toHaveLength(1)
      expect(items[0]!.kind).toBe('fact')
      const limited = await call(svc, 'GET', `${MEMORY_API_PATH}/memories?limit=1`)
      expect((limited.json as { items: unknown[] }).items).toHaveLength(1)
      const text = await call(svc, 'GET', `${MEMORY_API_PATH}/memories?text=Other`)
      expect((text.json as { items: { title: string }[] }).items.map(row => row.title)).toEqual(['Other'])
      const single = await call(svc, 'GET', `${MEMORY_API_PATH}/memories/${encodeURIComponent(items[0]!.id)}`)
      expect(single.status).toBe(200)
      expect((single.json as { item: { title: string } }).item.title).toBe('API')
      const missing = await call(svc, 'GET', `${MEMORY_API_PATH}/memories/nope`)
      expect(missing.status).toBe(404)
    } finally {
      await fiber.dispose()
    }
  })

  it('serves the event log and rejects unknown routes', async () => {
    const { fiber, svc } = await service()
    try {
      await svc.remember({ scope: { type: 'global' }, kind: 'preference', title: 'Lang', content: 'zh' })
      const events = await call(svc, 'GET', `${MEMORY_API_PATH}/events?limit=10`)
      expect(events.status).toBe(200)
      expect((events.json as { events: unknown[] }).events).toHaveLength(1)
      expect(await call(svc, 'GET', `${MEMORY_API_PATH}/nope`)).toMatchObject({ status: 404 })
    } finally {
      await fiber.dispose()
    }
  })

  it('serves the scope tree with counts and filters memories by scopeKey', async () => {
    const { fiber, svc } = await service()
    try {
      await svc.remember({ scope: { type: 'global' }, kind: 'fact', title: 'G1', content: 'a' })
      await svc.remember({ scope: { type: 'project', id: '/repo' }, kind: 'fact', title: 'P1', content: 'b' })
      await svc.remember({ scope: { type: 'project', id: '/repo' }, kind: 'skill', title: 'S1', content: 'c' })
      await svc.remember({ scope: { type: 'session', id: 's1', parent: { type: 'project', id: '/repo' } }, kind: 'fact', title: 'X1', content: 'd' })

      const tree = await call(svc, 'GET', `${MEMORY_API_PATH}/scopes`)
      expect(tree.status).toBe(200)
      const roots = (tree.json as { roots: { key: string; count: number; children: { key: string }[] }[] }).roots
      expect(roots).toHaveLength(2)
      expect(roots[0]).toMatchObject({ key: 'global', count: 1 })
      const project = roots.find(node => node.key === 'project:%2Frepo')
      expect(project).toMatchObject({ count: 2 })
      expect(project?.children.map(child => child.key)).toEqual(['project:%2Frepo/session:s1'])

      const byKey = await call(svc, 'GET', `${MEMORY_API_PATH}/memories?scopeKey=${encodeURIComponent('project:%2Frepo/session:s1')}`)
      expect((byKey.json as { items: { title: string }[] }).items.map(row => row.title)).toEqual(['X1'])
    } finally {
      await fiber.dispose()
    }
  })

  it('consolidates a scope through the endpoint', async () => {
    const { fiber, svc } = await service()
    try {
      await svc.setModelRunner({ complete: async () => JSON.stringify({ memories: [
        { kind: 'fact', title: 'Merged', content: 'one' },
      ] }) })
      await svc.remember({ scope: { type: 'global' }, kind: 'fact', title: 'A', content: 'a' })
      await svc.remember({ scope: { type: 'global' }, kind: 'fact', title: 'B', content: 'b' })
      const response = await call(svc, 'POST', `${MEMORY_API_PATH}/consolidate`, { scope: { type: 'global' } })
      expect(response.status).toBe(200)
      expect((response.json as { result: { before: number; after: number } }).result).toMatchObject({ before: 2, after: 1 })
      const invalid = await call(svc, 'POST', `${MEMORY_API_PATH}/consolidate`, { scope: { type: 'nope' } })
      expect(invalid.status).toBe(400)
    } finally {
      await fiber.dispose()
    }
  })

  it('imports a workspace through the endpoint', async () => {
    const { fiber, svc } = await service()
    try {
      const cwd = join(mkdtempSync(join(tmpdir(), 'evo-web-import-')), 'project')
      mkdirSync(cwd, { recursive: true })
      writeFileSync(join(cwd, 'CLAUDE.md'), '# Rules\n\nBe concise')
      const response = await call(svc, 'POST', `${MEMORY_API_PATH}/import-workspace`, { cwd })
      expect(response.status).toBe(200)
      expect((response.json as { result: { created: number } }).result.created).toBe(1)
      const missing = await call(svc, 'POST', `${MEMORY_API_PATH}/import-workspace`, {})
      expect(missing.status).toBe(400)
    } finally {
      await fiber.dispose()
    }
  })

  it('still answers on the pre-rename /evo-memory prefix', async () => {
    const { fiber, svc } = await service()
    try {
      const status = await call(svc, 'GET', `${LEGACY_MEMORY_API_PATH}/status`)
      expect(status.status).toBe(200)
      expect(status.json).toMatchObject({ ok: true })
      expect((await call(svc, 'GET', '/evo-memoryish/status')).status).toBe(404)
    } finally {
      await fiber.dispose()
    }
  })

  it('serves skills from /evo/skills endpoint', async () => {
    const { fiber, svc } = await service()
    try {
      const scope = { type: 'project' as const, id: '/test-skills' }
      await svc.remember({ scope, kind: 'skill', title: '.claude/skills/test-skill/SKILL.md', content: '# Test\n\n## Purpose\n\nTest\n\n## When to use\n\nTesting\n\n## Steps\n\n1. Test\n\n## Verification\n\nPass' })

      const response = await call(svc, 'GET', `${MEMORY_API_PATH}/skills`)
      expect(response.status).toBe(200)
      const skills = (response.json as { skills: Array<{ name: string; source: string }> }).skills
      expect(skills.length).toBeGreaterThanOrEqual(1)
      const testSkill = skills.find(s => s.name === 'test-skill')
      expect(testSkill).toBeDefined()
      expect(testSkill!.source).toBe('human')
    } finally {
      await fiber.dispose()
    }
  })

  it('serves skills from skills table via /evo/skills', async () => {
    const { fiber, svc } = await service()
    try {
      const scope = { type: 'project' as const, id: '/test-repo' }
      svc.setModelRunner({
        complete: async () => JSON.stringify({
          memories: [],
          skill: {
            name: 'evo-learned-skill',
            body: {
              purpose: 'Test evo skill',
              trigger: 'When testing',
              steps: '1. Do test',
              check: 'Test passes',
            },
          },
        }),
      })
      await svc.reflect({ sessionId: 's1', turn: 1, scope, user: 'Test', assistant: 'Done' })

      const response = await call(svc, 'GET', `${MEMORY_API_PATH}/skills?scopeType=project&scopeId=${encodeURIComponent('/test-repo')}`)
      expect(response.status).toBe(200)
      const skills = (response.json as { skills: Array<{ name: string; source: string }> }).skills
      const evoSkill = skills.find(s => s.name === 'evo-learned-skill')
      expect(evoSkill).toBeDefined()
      expect(evoSkill!.source).toBe('evo')
    } finally {
      await fiber.dispose()
    }
  })

  it('skills endpoint returns shape expected by panel (name, trigger, path, usageCount, dormant, promoted, scope)', async () => {
    const { fiber, svc } = await service()
    try {
      svc.setModelRunner({
        complete: async () => JSON.stringify({
          memories: [],
          skill: {
            name: 'panel-test-skill',
            body: {
              purpose: 'Panel verification',
              trigger: 'When verifying panel integration\n- Additional trigger detail',
              steps: '1. Step one\n2. Step two',
              check: 'Panel shows all fields',
            },
          },
        }),
      })

      await svc.core.reflectBatch([
        { sessionId: 's', turn: 1, scope: { type: 'project', id: '/test' }, user: 'create skill', assistant: 'done' },
      ])

      const response = await call(svc, 'GET', `${MEMORY_API_PATH}/skills?scopeType=project&scopeId=%2Ftest`)
      expect(response.status).toBe(200)
      const { skills } = response.json as { skills: Array<{
        name: string
        trigger: string
        path: string
        usageCount: number
        dormant: boolean
        promoted: boolean
        scope: { type: string; id?: string }
      }> }
      expect(skills).toHaveLength(1)
      const skill = skills[0]!
      expect(skill.name).toBe('panel-test-skill')
      expect(skill.trigger).toBe('When verifying panel integration')
      expect(skill.path).toContain('panel-test-skill')
      expect(typeof skill.usageCount).toBe('number')
      expect(skill.usageCount).toBe(0)
      expect(typeof skill.dormant).toBe('boolean')
      expect(skill.dormant).toBe(false)
      expect(typeof skill.promoted).toBe('boolean')
      expect(skill.promoted).toBe(false)
      expect(skill.scope).toMatchObject({ type: 'project', id: '/test' })
    } finally {
      await fiber.dispose()
    }
  })

  it('returns backlog info via /backlog endpoint', async () => {
    const { fiber, svc } = await service()
    try {
      svc.setModelRunner({
        complete: async () => JSON.stringify({
          memories: [{ kind: 'fact', title: 'Test', content: 'value' }],
        }),
      })

      await svc.core.reflectBatch([
        { sessionId: 's', turn: 1, scope: { type: 'project', id: '/repo' }, user: 'test', assistant: 'done' },
      ])

      const response = await call(svc, 'GET', `${MEMORY_API_PATH}/backlog?scopeType=project&scopeId=%2Frepo`)
      expect(response.status).toBe(200)
      expect(response.json).toMatchObject({
        replaySize: 1,
        scope: { type: 'project', id: '/repo' },
      })

      const missing = await call(svc, 'GET', `${MEMORY_API_PATH}/backlog`)
      expect(missing.status).toBe(400)
    } finally {
      await fiber.dispose()
    }
  })

  it('deduplicates skills by path, not just name', async () => {
    const { fiber, svc } = await service()
    try {
      const cwd = join(mkdtempSync(join(tmpdir(), 'evo-dedup-')), 'project')
      mkdirSync(cwd, { recursive: true })
      mkdirSync(join(cwd, '.claude/skills/build'), { recursive: true })
      mkdirSync(join(cwd, '.codex/skills/build'), { recursive: true })
      writeFileSync(join(cwd, '.claude/skills/build/SKILL.md'), '# Build\n\n## Purpose\nClaude build\n\n## When to use\nUse Claude build\n\n## Steps\n1. Do it\n\n## Verification\nDone')
      writeFileSync(join(cwd, '.codex/skills/build/SKILL.md'), '# Build\n\n## Purpose\nCodex build\n\n## When to use\nUse Codex build\n\n## Steps\n1. Do it\n\n## Verification\nDone')

      const response = await call(svc, 'GET', `${MEMORY_API_PATH}/skills?cwd=${encodeURIComponent(cwd)}&includeGlobal=false`)
      expect(response.status).toBe(200)
      const skills = (response.json as { skills: Array<{ name: string; path: string }> }).skills
      const buildSkills = skills.filter(s => s.name === 'build')
      expect(buildSkills).toHaveLength(2)
      const paths = buildSkills.map(s => s.path).sort()
      expect(paths).toEqual(['.claude/skills/build/SKILL.md', '.codex/skills/build/SKILL.md'])
    } finally {
      await fiber.dispose()
    }
  })

  it('includes disk-discovered skills in context with correct paths', async () => {
    const { fiber, svc } = await service()
    try {
      const cwd = join(mkdtempSync(join(tmpdir(), 'evo-ctx-')), 'project')
      mkdirSync(cwd, { recursive: true })
      mkdirSync(join(cwd, '.claude/skills/my-skill'), { recursive: true })
      writeFileSync(join(cwd, '.claude/skills/my-skill/SKILL.md'), '# My Skill\n\n## Purpose\nDo something\n\n## When to use\nWhen you need to do something\n\n## Steps\n1. Do it\n\n## Verification\nDone')

      const context = await svc.context({ cwd, includeGlobal: false })
      expect(context).toContain('my-skill')
      expect(context).toContain('.claude/skills/my-skill/SKILL.md')
    } finally {
      await fiber.dispose()
    }
  })
})
