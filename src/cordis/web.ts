import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { memoryScopeSchema, type MemoryKind, type MemoryQuery, type MemoryScope } from '../core/types.js'
import { parseScopeKey } from '../core/scope-tree.js'
import type { EvoMemoryCordisService } from './service.js'

/**
 * evo-memory HTTP API, mounted at `/evo-memory/*` on the DSH web server
 * (the `/api` prefix is owned by the DSH web transport, so a plugin bridge
 * must use its own path). Endpoints are loopback-local by default and exist
 * as the reserved integration surface for external frontends:
 *
 *   GET  /evo-memory/status
 *   GET  /evo-memory/memories?scopeType=&scopeId=&kind=&text=&tags=&limit=
 *   GET  /evo-memory/memories/:id
 *   GET  /evo-memory/events?limit=
 *   POST /evo-memory/consolidate            body { scope: {type, id?} }
 *   POST /evo-memory/import-workspace       body { cwd, force? }
 */
export const MEMORY_API_PATH = '/evo-memory'

export function registerMemoryApi(ctx: Context, service: EvoMemoryCordisService): void {
  const webServer = ctx.get('webServer')
  if (!webServer) return
  ctx.effect(() => webServer.register({ kind: 'prefix', path: MEMORY_API_PATH, handler: createMemoryApiHandler(service) }),
    'evo-memory: api routes')
}

export function createMemoryApiHandler(service: EvoMemoryCordisService): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://evo.local')
      const pathname = url.pathname
      const rest = pathname === MEMORY_API_PATH ? '/' : pathname.startsWith(`${MEMORY_API_PATH}/`) ? pathname.slice(MEMORY_API_PATH.length) : null
      if (rest === null) return send(res, 404, { error: 'not found' })

      if (req.method === 'GET' && (rest === '/' || rest === '/status')) return send(res, 200, service.status())
      if (req.method === 'GET' && rest === '/memories') {
        const query = parseMemoryQuery(url)
        return send(res, 200, { items: await service.recall(query) })
      }
      if (req.method === 'GET' && rest === '/scopes') {
        return send(res, 200, { roots: await service.scopes() })
      }
      const single = rest.match(/^\/memories\/([^/]+)$/)
      if (req.method === 'GET' && single) {
        const item = await service.get(decodeURIComponent(single[1]!))
        return item ? send(res, 200, { item }) : send(res, 404, { error: 'memory not found' })
      }
      if (req.method === 'GET' && rest === '/events') {
        const limit = Number(url.searchParams.get('limit') ?? 50)
        return send(res, 200, { events: await service.events(Number.isFinite(limit) ? limit : 50) })
      }
      if (req.method === 'POST' && rest === '/consolidate') {
        const body = await readJson(req)
        const parsed = memoryScopeSchema.safeParse(body?.scope)
        if (!parsed.success) return send(res, 400, { error: 'body.scope must be a MemoryScope: {type, id?}', detail: parsed.error.issues })
        return send(res, 200, { result: await service.consolidate(parsed.data) })
      }
      if (req.method === 'POST' && rest === '/import-workspace') {
        const body = await readJson(req)
        if (typeof body?.cwd !== 'string' || !body.cwd.trim()) return send(res, 400, { error: 'body.cwd must be a non-empty string' })
        return send(res, 200, { result: await service.importWorkspace(body.cwd, { force: body.force === true }) })
      }
      return send(res, 404, { error: 'not found' })
    } catch (error) {
      return send(res, 500, { error: String(error instanceof Error ? error.message : error) })
    }
  }
}

function parseMemoryQuery(url: URL): MemoryQuery {
  const params = url.searchParams
  const query: MemoryQuery = {}
  const scopeKeyParam = params.get('scopeKey')
  if (scopeKeyParam) {
    const scope = parseScopeKey(scopeKeyParam)
    if (scope) query.scopes = [scope]
  }
  const scopeType = params.get('scopeType')
  if (!scopeKeyParam && scopeType) {
    const scope: MemoryScope = { type: scopeType as MemoryScope['type'] }
    const scopeId = params.get('scopeId')
    if (scopeId) scope.id = scopeId
    if (memoryScopeSchema.safeParse(scope).success) query.scopes = [scope]
  }
  const kind = params.get('kind')
  if (kind) {
    const kinds = kind.split(',').map(part => part.trim()).filter(Boolean) as MemoryKind[]
    if (kinds.length) query.kinds = kinds
  }
  const text = params.get('text')
  if (text) query.text = text
  const tags = params.get('tags')
  if (tags) query.tags = tags.split(',').map(part => part.trim()).filter(Boolean)
  const limit = Number(params.get('limit') ?? 100)
  if (Number.isFinite(limit)) query.limit = limit
  return query
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (!chunks.length) return null
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}
