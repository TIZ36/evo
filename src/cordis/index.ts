import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as PluginConfig } from './config.js'
import { EvoMemoryCordisService } from './service.js'
import { registerMemoryApi } from './web.js'

export const name = 'evo-memory'
export { Config, EvoMemoryCordisService, registerMemoryApi }
export type { PluginConfig }

export function apply(ctx: Context, config: PluginConfig = {}): void {
  const service = new EvoMemoryCordisService(ctx, config)
  registerMemoryApi(ctx, service)
}
