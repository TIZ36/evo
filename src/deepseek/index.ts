import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PromptAssembly, AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import '../cordis/service.js'
import { DeepSeekModelRunner } from './model-runner.js'
import { extractCompletedTurn, scopesForSession } from './events.js'

export { DeepSeekModelRunner } from './model-runner.js'
export * from './events.js'

export const name = 'evo-memory-deepseek'
export const inject = ['evoMemory', 'llm', 'systemPrompt']

export interface Config {
  provider: string
  model: string
  maxTokens?: number
  temperature?: number
  recallLimit?: number
  maxContextChars?: number
  reflect?: boolean
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  maxTokens: z.number().min(1).max(65536),
  temperature: z.number().min(0).max(2),
  recallLimit: z.number().min(1).max(200).default(40),
  maxContextChars: z.number().min(100).max(50000).default(6000),
  reflect: z.boolean().default(true),
})

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('evo-memory')
  const releaseModel = ctx.evoMemory.setModelRunner(new DeepSeekModelRunner(ctx, config))
  ctx.effect(() => releaseModel, 'evoMemory.releaseModel')

  ctx.on('system-prompt/assemble', async (assembly: PromptAssembly, context: AssembleContext, next) => {
    const result = await next()
    const session = context.agent?.session
    if (!session) return result
    const text = await ctx.evoMemory.context({ scopes: scopesForSession(session), limit: config.recallLimit ?? 40, maxChars: config.maxContextChars ?? 6000 })
    if (!text) return result
    return { ...result, contexts: [...result.contexts, { name: 'evo-memory', text }] }
  })

  if (config.reflect !== false) {
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (event.type !== 'turn/end') return
      const turn = extractCompletedTurn(session, event.data.turn)
      if (!turn) return
      void ctx.evoMemory.reflect(turn).catch(error => logger.warn('reflection failed: %s', String(error)))
    })
  }
}
