import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ModelRunner } from '../core/contracts.js'

export type DeepSeekModelConfig = {
  provider: string
  model: string
  maxTokens?: number
  temperature?: number
}

export class DeepSeekModelRunner implements ModelRunner {
  constructor(private readonly ctx: Context, private readonly config: DeepSeekModelConfig) {}

  async complete(request: Parameters<ModelRunner['complete']>[0]): Promise<string> {
    let output = ''
    for await (const chunk of this.ctx.llm.stream({
      provider: this.config.provider,
      model: this.config.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: request.prompt }], source: { kind: 'plugin', plugin: 'evo' } })],
      ...(this.config.maxTokens === undefined ? {} : { maxTokens: this.config.maxTokens }),
      ...(this.config.temperature === undefined ? {} : { temperature: this.config.temperature }),
      ...(request.signal ? { signal: request.signal } : {}),
    })) {
      if (chunk.type === 'text-delta') output += chunk.text
      if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        throw new Error(`evo model call failed: ${chunk.reason.failure.message}`)
      }
    }
    if (!output.trim()) throw new Error('evo model returned no text')
    return output
  }
}
