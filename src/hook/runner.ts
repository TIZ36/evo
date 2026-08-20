import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

export type CodexCliOptions = {
  /** Executable on PATH; the Codex CLI by default. */
  command?: string
  /** Empty means "whatever the user's Codex config already selects". */
  model?: string
  timeoutMs?: number
  maxPromptChars?: number
}

/**
 * Reflection through the local Codex CLI (`codex exec`), the counterpart of
 * {@link ClaudeCliModelRunner}: the hook borrows the credentials and the model
 * the host CLI is already configured with, so a plugin install needs no key.
 *
 * Two differences from Claude Code shape this. Codex prints a rendered
 * transcript on stdout, so the answer is collected through
 * `--output-last-message` instead; and it has no default model of its own worth
 * hardcoding, so an unset model means the user's own configuration.
 */
export class CodexCliModelRunner implements ModelRunner {
  private readonly command: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly maxPromptChars: number

  constructor(options: CodexCliOptions = {}) {
    this.command = options.command ?? 'codex'
    this.model = options.model?.trim() ?? ''
    // Codex starts a whole agent session per call, which is slower than a bare
    // completion; reflection is detached, so patience costs the session nothing.
    this.timeoutMs = options.timeoutMs ?? 300_000
    this.maxPromptChars = options.maxPromptChars ?? 24_000
  }

  complete(request: { purpose: 'reflect' | 'consolidate'; prompt: string; signal?: AbortSignal }): Promise<string> {
    const prompt = request.prompt.length > this.maxPromptChars
      ? `${request.prompt.slice(0, this.maxPromptChars)}\n…[truncated]`
      : request.prompt
    // Reflection is a pure text task: no repository, no writes, no session file.
    const dir = mkdtempSync(join(tmpdir(), 'evo-reflect-'))
    const answerPath = join(dir, 'answer.txt')
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--sandbox', 'read-only',
      '--output-last-message', answerPath, '--cd', dir]
    if (this.model) args.push('--model', this.model)
    args.push(prompt)

    return new Promise((resolve, reject) => {
      const child = execFile(this.command, args, {
        timeout: this.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, EVO_HOOK_DISABLE: '1' },
        ...(request.signal ? { signal: request.signal } : {}),
      }, error => {
        try {
          if (error) return reject(new Error(`${this.command} ${request.purpose} failed: ${error.message}`))
          const answer = readText(answerPath)
          if (!answer.trim()) return reject(new Error(`${this.command} ${request.purpose} returned no text`))
          resolve(answer)
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      })
      // `codex exec` appends piped stdin to the prompt, so it waits for EOF that
      // a detached hook never sends. Closing it is what makes the call return.
      child.stdin?.end()
    })
  }
}

function readText(path: string): string {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}
