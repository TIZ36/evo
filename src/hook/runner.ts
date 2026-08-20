import { execFile } from 'node:child_process'
import type { ModelRunner } from '../core/contracts.js'

export type ClaudeCliOptions = {
  /** Executable on PATH; the Claude Code CLI by default. */
  command?: string
  model?: string
  timeoutMs?: number
  maxPromptChars?: number
}

export const DEFAULT_HOOK_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Reflection through the local Claude Code CLI (`claude -p`), so a hook install
 * needs no API key of its own — it reuses whatever credentials Claude Code
 * already has. The child is marked with EVO_HOOK_DISABLE so its own hooks exit
 * immediately; without that guard, reflection would recurse forever.
 */
export class ClaudeCliModelRunner implements ModelRunner {
  private readonly command: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly maxPromptChars: number

  constructor(options: ClaudeCliOptions = {}) {
    this.command = options.command ?? 'claude'
    this.model = options.model ?? DEFAULT_HOOK_MODEL
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.maxPromptChars = options.maxPromptChars ?? 24_000
  }

  complete(request: { purpose: 'reflect' | 'consolidate'; prompt: string; signal?: AbortSignal }): Promise<string> {
    const prompt = request.prompt.length > this.maxPromptChars
      ? `${request.prompt.slice(0, this.maxPromptChars)}\n…[truncated]`
      : request.prompt
    return new Promise((resolve, reject) => {
      execFile(this.command, ['-p', prompt, '--model', this.model], {
        timeout: this.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, EVO_HOOK_DISABLE: '1' },
        ...(request.signal ? { signal: request.signal } : {}),
      }, (error, stdout) => {
        if (error) return reject(new Error(`${this.command} ${request.purpose} failed: ${error.message}`))
        if (!stdout.trim()) return reject(new Error(`${this.command} ${request.purpose} returned no text`))
        resolve(stdout)
      })
    })
  }
}
