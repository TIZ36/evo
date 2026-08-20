import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as PluginConfig } from './config.js'
import { EvoCordisService } from './service.js'
import { registerMemoryApi } from './web.js'

export const name = 'evo'
export { Config, EvoCordisService, registerMemoryApi }
export type { PluginConfig }

export function apply(ctx: Context, config: PluginConfig = {}): void {
  const service = new EvoCordisService(ctx, config)
  registerMemoryApi(ctx, service)
}
