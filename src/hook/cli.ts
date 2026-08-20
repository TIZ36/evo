#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDataPaths } from '../config/paths.js'
import type { MemoryDelta } from '../core/types.js'
import { EvoService } from '../core/evo.js'
import { SqliteMemoryStore } from '../storage/sqlite-store.js'
import { WorkspaceImporter } from '../workspace/importer.js'
import { ClaudeCliModelRunner, CodexCliModelRunner, DEFAULT_HOOK_MODEL } from './runner.js'
import { extractLatestCodexTurn, isCodexTranscript, parseCodexTranscript } from './codex-transcript.js'
import { hookHost, type HookHost } from './host.js'
import { formatNotice, takeNotice, writeNotice } from './notice.js'
import { canonicalPath, hookScopes, projectScope } from './scope.js'
import { extractLatestTurn, parseTranscript, type TurnDraft } from './transcript.js'

/**
 * The subset of the hook payload evo reads. Claude Code and Codex send the same
 * envelope for the events evo takes part in, so one shape serves both.
 */
export type HookEvent = {
  hook_event_name?: string
  session_id?: string
  cwd?: string
  transcript_path?: string
  last_assistant_message?: string
  session_start_reason?: string
}

export type HookConfig = {
  recallLimit: number
  maxChars: number
  reflect: boolean
  importWorkspace: boolean
  model: string
  notify: boolean
  debug: boolean
}

export function hookConfig(env: NodeJS.ProcessEnv = process.env): HookConfig {
  return {
    recallLimit: positive(env.EVO_HOOK_RECALL_LIMIT) ?? 40,
    maxChars: positive(env.EVO_HOOK_MAX_CHARS) ?? 6000,
    reflect: env.EVO_HOOK_REFLECT !== '0',
    importWorkspace: env.EVO_HOOK_IMPORT !== '0',
    // Empty means "each host's own default"; the runners resolve it.
    model: env.EVO_HOOK_MODEL?.trim() ?? '',
    notify: env.EVO_HOOK_NOTIFY !== '0',
    debug: env.EVO_HOOK_DEBUG === '1',
  }
}

/**
 * Text injected into the model's context. Both hosts pass a `SessionStart` /
 * `UserPromptSubmit` hook's `additionalContext` to the model verbatim, so
 * recall is simply the rendered memory context — empty when there is nothing
 * to say.
 */
export async function recallContext(event: HookEvent, service: EvoService, config: HookConfig): Promise<string> {
  return service.context({ scopes: hookScopes(event.cwd), limit: config.recallLimit, maxChars: config.maxChars })
}

/**
 * Rebuilds the finished turn from the transcript and distils it into memory.
 * The transcript text is passed in when the caller has already read it — the
 * host is decided from the same bytes, and a rollout can be large.
 */
export async function reflectTurn(event: HookEvent, service: EvoService, transcript?: string): Promise<MemoryDelta | null> {
  const text = transcript ?? readTranscript(event)
  if (text === null) return null
  const draft = draftTurn(text, event.last_assistant_message)
  if (!draft || !draft.user || !draft.assistant) return null
  return service.reflect({
    sessionId: event.session_id ?? 'agent-hook',
    turn: draft.turn,
    scope: event.cwd ? projectScope(event.cwd) : { type: 'global' },
    user: draft.user,
    assistant: draft.assistant,
    tools: draft.tools,
  })
}

/**
 * Both hosts render `systemMessage` as their own element in the transcript, so
 * it is evo's only visible surface here. It stays silent on an ordinary recall
 * and speaks only when evo learned something, or when it is broken.
 */
export function hookOutput(context: string, systemMessage?: string, event?: HookEvent): string {
  const payload: Record<string, unknown> = {}
  if (context.trim()) {
    payload.hookSpecificOutput = { hookEventName: event?.hook_event_name ?? 'UserPromptSubmit', additionalContext: context }
  }
  if (systemMessage) payload.systemMessage = systemMessage
  return Object.keys(payload).length ? JSON.stringify(payload) : ''
}

/**
 * Only a prompt turn can show a notice: SessionStart consumes hook output
 * without rendering a system message, so a notice taken there would vanish.
 */
export function noticeMessage(event: HookEvent, config: HookConfig, dir: string): string | undefined {
  if (!config.notify || event.hook_event_name !== 'UserPromptSubmit') return undefined
  return formatNotice(takeNotice(dir))
}

/** Reads the event's transcript, or null when there is none to read. */
export function readTranscript(event: HookEvent): string | null {
  if (!event.transcript_path) return null
  try { return readFileSync(event.transcript_path, 'utf8') } catch { return null }
}

/** One turn out of either host's transcript format, told apart by its content. */
export function draftTurn(transcript: string, fallbackAssistant?: string): TurnDraft | null {
  return isCodexTranscript(transcript)
    ? extractLatestCodexTurn(parseCodexTranscript(transcript), fallbackAssistant)
    : extractLatestTurn(parseTranscript(transcript), fallbackAssistant)
}

/** Reflection is delegated to the host's own CLI, with the host's own credentials. */
export function modelRunner(host: HookHost, config: HookConfig): ClaudeCliModelRunner | CodexCliModelRunner {
  return host === 'codex'
    ? new CodexCliModelRunner({ model: config.model })
    : new ClaudeCliModelRunner({ model: config.model || DEFAULT_HOOK_MODEL })
}

export function openService(): { service: EvoService; store: SqliteMemoryStore } {
  const store = new SqliteMemoryStore(resolveDataPaths().databasePath)
  return { service: new EvoService({ store, events: store }), store }
}

// ── entry ─────────────────────────────────────────────────────────────────
const selfPath = fileURLToPath(import.meta.url)

async function main(): Promise<void> {
  // Recursion guard: reflection spawns the host CLI again, whose hooks would
  // otherwise spawn reflection again, forever.
  if (process.env.EVO_HOOK_DISABLE === '1') return

  const config = hookConfig()
  const [mode, payloadPath] = process.argv.slice(2)

  if (mode === 'reflect' && payloadPath) return runDetachedReflect(payloadPath, config)

  const raw = readFileSync(0, 'utf8')
  if (!raw.trim()) return
  const event = JSON.parse(raw) as HookEvent
  const { service, store } = openService()
  try {
    if (event.hook_event_name === 'Stop') {
      if (config.reflect) detachReflect(event)
      return
    }
    if (event.hook_event_name === 'SessionStart' && config.importWorkspace && event.cwd) {
      const imported = await new WorkspaceImporter(store).import(canonicalPath(event.cwd))
      if (config.debug) log(`import created=${imported.created} updated=${imported.updated} skipped=${imported.skipped}`)
    }
    const text = await recallContext(event, service, config)
    if (config.debug) log(`${event.hook_event_name ?? 'event'} recall ${countItems(text)} memories, ${text.length} chars`)
    const notice = noticeMessage(event, config, dataDir())
    const output = hookOutput(text, notice, event)
    if (output) process.stdout.write(output)
  } finally {
    store.close?.()
  }
}

function dataDir(): string {
  return resolveDataPaths().dataDir ?? tmpdir()
}

/** Hands the turn to a detached child: reflection takes seconds, the hook must not. */
function detachReflect(event: HookEvent): void {
  const dir = mkdtempSync(join(tmpdir(), 'evo-hook-'))
  const payloadPath = join(dir, 'event.json')
  writeFileSync(payloadPath, JSON.stringify(event))
  spawn(process.execPath, [selfPath, 'reflect', payloadPath], { detached: true, stdio: 'ignore' }).unref()
}

async function runDetachedReflect(payloadPath: string, config: HookConfig): Promise<void> {
  const event = JSON.parse(readFileSync(payloadPath, 'utf8')) as HookEvent
  rmSync(dirname(payloadPath), { recursive: true, force: true })
  const transcript = readTranscript(event)
  const host = hookHost(process.env, transcript ?? undefined)
  const { service, store } = openService()
  service.setModelRunner(modelRunner(host, config))
  try {
    const delta = transcript === null ? null : await reflectTurn(event, service, transcript)
    if (delta && config.notify) writeNotice(dataDir(), delta)
    if (!config.debug) return
    log(delta
      ? `reflect ok host=${host} created=${delta.created.length} updated=${delta.updated.length}`
      : `reflect skipped: no usable turn in the ${host} transcript`)
  } finally {
    store.close?.()
  }
}

/** Hook failures are silent in the session, so they must be recoverable from disk. */
function log(message: string): void {
  const path = process.env.EVO_HOOK_LOG?.trim() || join(dataDir(), 'hook.log')
  try { appendFileSync(path, `${new Date().toISOString()} ${message}\n`) } catch { /* logging must never throw */ }
}

/** Rendered context is one memory per line under a single heading. */
function countItems(text: string): number {
  return text.split('\n').filter(line => line.startsWith('- [')).length
}

function positive(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

if (process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(selfPath)) {
  main().catch(error => {
    const reason = String(error instanceof Error ? error.message : error)
    log(`ERROR ${String(error instanceof Error ? error.stack ?? error.message : error)}`)
    if (hookConfig().notify) process.stdout.write(JSON.stringify({ systemMessage: `evo · memory unavailable: ${reason}` }))
  })
    .finally(() => process.exit(0))
}
