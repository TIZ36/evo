import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PromptAssembly, AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import '../cordis/service.js'
import { DeepSeekModelRunner } from './model-runner.js'
import { extractCompletedTurn, scopesForSession } from './events.js'
import { scopeKey } from '../core/types.js'
import type { WorkspaceImportResult } from '../workspace/importer.js'

export { DeepSeekModelRunner } from './model-runner.js'
export * from './events.js'

export const name = 'evo-deepseek'
export const inject = ['evo', 'llm', 'systemPrompt']

export interface Config {
  provider: string
  model: string
  maxTokens?: number
  temperature?: number
  recallLimit?: number
  maxContextChars?: number
  reflect?: boolean
  /** Import project-local agent memory/skill files (.claude/.codex/.copilot/.agent/.paper) once per project. */
  workspaceImport?: boolean
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  maxTokens: z.number().min(1).max(65536),
  temperature: z.number().min(0).max(2),
  recallLimit: z.number().min(1).max(200).default(40),
  maxContextChars: z.number().min(100).max(50000).default(6000),
  reflect: z.boolean().default(true),
  workspaceImport: z.boolean().default(true),
})

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('evo')
  const releaseModel = ctx.evo.setModelRunner(new DeepSeekModelRunner(ctx, config))
  ctx.effect(() => releaseModel, 'evo.releaseModel')

  // One-shot workspace ingestion per project: imported once per process, with an
  // in-flight promise shared by concurrent sessions in the same project.
  const imported = new Set<string>()
  const importing = new Map<string, Promise<WorkspaceImportResult>>()
  const ensureWorkspaceImported = (cwd: string) => {
    const key = scopeKey({ type: 'project', id: cwd })
    if (imported.has(key)) return Promise.resolve()
    const existing = importing.get(key)
    const promise = existing ?? ctx.evo.importWorkspace(cwd).then(result => {
      imported.add(key)
      if (result.created + result.updated > 0) {
        logger.info('workspace import %s: %d created, %d updated, %d unchanged (%d files)',
          cwd, result.created, result.updated, result.unchanged, result.files)
      }
      return result
    })
    if (!existing) importing.set(key, promise)
    return promise
      .catch(error => logger.warn('workspace import failed for %s: %s', cwd, String(error)))
      .finally(() => { if (!existing) importing.delete(key) })
  }

  ctx.on('system-prompt/assemble', async (assembly: PromptAssembly, context: AssembleContext, next) => {
    const result = await next()
    const session = context.agent?.session
    if (!session) return result
    if (config.workspaceImport !== false && session.header.cwd) {
      await ensureWorkspaceImported(session.header.cwd)
    }
    const text = await ctx.evo.context({ scopes: scopesForSession(session), limit: config.recallLimit ?? 40, maxChars: config.maxContextChars ?? 6000, cwd: session.header.cwd })
    if (!text) return result
    return { ...result, contexts: [...result.contexts, { name: 'evo', text }] }
  })

  if (config.reflect !== false) {
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (event.type !== 'turn/end') return
      const turn = extractCompletedTurn(session, event.data.turn)
      if (!turn) return
      void ctx.evo.reflect(turn).catch(error => logger.warn('reflection failed: %s', String(error)))
    })
  }
}
