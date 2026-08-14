import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as PluginConfig } from './config.js'
import { EvoMemoryCordisService } from './service.js'

export const name = 'evo-memory'
export { Config, EvoMemoryCordisService }
export type { PluginConfig }

export function apply(ctx: Context, config: PluginConfig = {}): void {
  new EvoMemoryCordisService(ctx, config)
}
