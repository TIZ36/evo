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

  it('lists skills via /skills endpoint', async () => {
    const { fiber, svc } = await service()
    try {
      svc.setModelRunner({
        complete: async () => JSON.stringify({
          memories: [],
          skill: {
            name: 'test-skill',
            body: {
              purpose: 'Test purpose',
              trigger: 'When testing',
              steps: '1. Do this\n2. Do that',
              check: 'It works',
            },
          },
        }),
      })

      await svc.core.reflectBatch([
        { sessionId: 's', turn: 1, scope: { type: 'project', id: '/repo' }, user: 'learn skill', assistant: 'done' },
      ])

      const response = await call(svc, 'GET', `${MEMORY_API_PATH}/skills?scopeType=project&scopeId=%2Frepo`)
      expect(response.status).toBe(200)
      const skills = (response.json as { skills: { name: string; trigger: string; promoted: boolean }[] }).skills
      expect(skills).toHaveLength(1)
      expect(skills[0]).toMatchObject({
        name: 'test-skill',
        trigger: 'When testing',
        promoted: false,
      })
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
})
