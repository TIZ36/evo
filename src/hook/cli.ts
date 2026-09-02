#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDataPaths } from '../config/paths.js'
import type { MemoryDelta, MemoryScope, Turn } from '../core/types.js'
import { EvoService } from '../core/evo.js'
import { SqliteMemoryStore } from '../storage/sqlite-store.js'
import { WorkspaceImporter } from '../workspace/importer.js'
import { discoverSkillCatalog, discoverGlobalSkillCatalog } from '../workspace/skill-discovery.js'
import { ClaudeCliModelRunner, CodexCliModelRunner, DEFAULT_HOOK_MODEL } from './runner.js'
import { extractLatestCodexTurn, isCodexTranscript, parseCodexTranscript } from './codex-transcript.js'
import { hookHost, type HookHost } from './host.js'
import { formatError, formatNotice, takeError, takeNotice, writeError, writeNotice } from './notice.js'
import { canonicalPath, hookScopes, projectScope } from './scope.js'
import { batchTurns, enqueue, isDue, takeDue, type QueueLimits, type QueuedBatch } from './queue.js'
import { extractLatestTurn, parseTranscript, type TurnDraft } from './transcript.js'
import {
  formatCatalog,
  memoriesToCatalogEntries,
  mergeSkillsWithDisk,
  skillsToCatalogEntries,
  type CatalogResult,
  type CatalogSection,
} from './catalog.js'

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
  /** Include global (~/) skill directories in recall context. */
  includeGlobalSkills: boolean
  /** When a queued batch is distilled, and how much of each turn it keeps. */
  queue: QueueLimits
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
    includeGlobalSkills: env.EVO_HOOK_GLOBAL_SKILLS !== '0',
    /* EVO_HOOK_BATCH_TURNS=1 restores the old turn-by-turn behaviour. */
    queue: {
      turns: positive(env.EVO_HOOK_BATCH_TURNS) ?? 10,
      chars: positive(env.EVO_HOOK_BATCH_CHARS) ?? 12_000,
      idleMs: positive(env.EVO_HOOK_BATCH_IDLE_MS) ?? 300_000,
      userChars: positive(env.EVO_HOOK_TURN_USER_CHARS) ?? 400,
      assistantChars: positive(env.EVO_HOOK_TURN_ASSISTANT_CHARS) ?? 600,
      tools: positive(env.EVO_HOOK_TURN_TOOLS) ?? 20,
    },
  }
}

/**
 * Text injected into the model's context. Both hosts pass a `SessionStart` /
 * `UserPromptSubmit` hook's `additionalContext` to the model verbatim, so
 * recall is simply the rendered memory context — empty when there is nothing
 * to say.
 *
 * Disk-discovered skills are included the same way EvoCordisService.context
 * does for DSH: project skills from event.cwd, global skills from $HOME.
 */
export async function recallContext(event: HookEvent, service: EvoService, config: HookConfig): Promise<string> {
  const additionalSkills = []
  if (event.cwd) {
    additionalSkills.push(...discoverSkillCatalog(event.cwd))
  }
  if (config.includeGlobalSkills) {
    additionalSkills.push(...discoverGlobalSkillCatalog())
  }
  return service.context({
    scopes: hookScopes(event.cwd),
    limit: config.recallLimit,
    maxChars: config.maxChars,
    additionalSkills,
  })
}

/**
 * Rebuilds the finished turn from either host's transcript, or nothing usable to
 * reflect on. The transcript text is passed in when the caller has already read
 * it — the host is decided from the same bytes, and a rollout can be large.
 */
export function turnFrom(event: HookEvent, transcript?: string): Turn | null {
  const text = transcript ?? readTranscript(event)
  if (text === null) return null
  const draft = draftTurn(text, event.last_assistant_message)
  if (!draft || !draft.user || !draft.assistant) return null
  return {
    sessionId: event.session_id ?? 'agent-hook',
    turn: draft.turn,
    scope: event.cwd ? projectScope(event.cwd) : { type: 'global' },
    user: draft.user,
    assistant: draft.assistant,
    tools: draft.tools,
  }
}

/** Distils the event's own turn on its own. Batching is what the hook does instead. */
export async function reflectTurn(event: HookEvent, service: EvoService, transcript?: string): Promise<MemoryDelta | null> {
  const turn = turnFrom(event, transcript)
  return turn ? service.reflect(turn) : null
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
 *
 * Error notices take precedence: a broken reflect is more important than a
 * successful one that happened before it. Both are consumed so stale state
 * doesn't accumulate.
 */
export function noticeMessage(event: HookEvent, config: HookConfig, dir: string): string | undefined {
  if (!config.notify || event.hook_event_name !== 'UserPromptSubmit') return undefined
  const error = takeError(dir)
  const notice = takeNotice(dir)
  return formatError(error) ?? formatNotice(notice)
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
  return { service: new EvoService({ store, skillStore: store, events: store }), store }
}

// ── list subcommands ──────────────────────────────────────────────────────

/**
 * Build the full catalog of skills and memories for the given scopes.
 * Merges database entries with disk-discovered SKILL.md files.
 */
export async function buildCatalog(service: EvoService, store: SqliteMemoryStore, cwd?: string): Promise<CatalogResult> {
  const scopes = hookScopes(cwd)
  const projectRoot = cwd ? canonicalPath(cwd) : undefined

  const dbSkills = await service.listSkills({ scopes, includeDormant: true, limit: 1000 })
  const skillSummaries = mergeSkillsWithDisk(dbSkills, projectRoot)
  const skills = skillsToCatalogEntries(skillSummaries)

  const memories = await service.recall({ scopes, limit: 1000 })
  const memoryEntries = memoriesToCatalogEntries(memories)

  return { skills, memories: memoryEntries }
}

/**
 * Run the list subcommand: output catalog to stdout.
 */
export async function runList(section: CatalogSection, cwd?: string): Promise<void> {
  const { service, store } = openService()
  try {
    const catalog = await buildCatalog(service, store, cwd)
    const output = formatCatalog(catalog, section)
    process.stdout.write(output)
  } finally {
    store.close?.()
  }
}

/** Parse --cwd=<path> or --cwd <path> from args, return the rest and the cwd value. */
function parseCwdArg(args: string[]): { cwd: string | undefined; rest: string[] } {
  const rest: string[] = []
  let cwd: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--cwd' && args[i + 1]) {
      cwd = args[++i]
    } else if (arg.startsWith('--cwd=')) {
      cwd = arg.slice(6)
    } else {
      rest.push(arg)
    }
  }
  return { cwd, rest }
}

// ── entry ─────────────────────────────────────────────────────────────────
const selfPath = fileURLToPath(import.meta.url)

async function main(): Promise<void> {
  // Recursion guard: reflection spawns the host CLI again, whose hooks would
  // otherwise spawn reflection again, forever.
  if (process.env.EVO_HOOK_DISABLE === '1') return

  const config = hookConfig()
  const { cwd: argCwd, rest: args } = parseCwdArg(process.argv.slice(2))
  const [mode, payloadPath] = args

  if (mode === 'flush' && payloadPath) return runDetachedFlush(payloadPath, config)

  if (mode === 'list' || mode === 'list-skills' || mode === 'list-memory') {
    const section: CatalogSection = mode === 'list-skills' ? 'skills' : mode === 'list-memory' ? 'memory' : 'all'
    const cwd = argCwd ?? process.cwd()
    return runList(section, cwd)
  }

  const raw = readFileSync(0, 'utf8')
  if (!raw.trim()) return
  const event = JSON.parse(raw) as HookEvent
  const { service, store } = openService()
  try {
    if (event.hook_event_name === 'Stop') {
      if (config.reflect) queueTurn(event, config)
      return
    }
    /* No process lives between turns, so the idle deadline is settled here:
       a prompt settles this project, a session start settles every project
       left hanging when work stopped. */
    if (config.reflect) {
      const scope = event.hook_event_name === 'SessionStart' ? undefined : event.cwd ? projectScope(event.cwd) : undefined
      flushDue(event, config, scope)
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

/** Queues the finished turn, and distils only once the batch is worth a model call. */
function queueTurn(event: HookEvent, config: HookConfig): void {
  /* Read once: the turn is rebuilt from these bytes and the host is decided by
     them too, and a rollout can be large. */
  const transcript = readTranscript(event)
  const turn = transcript === null ? null : turnFrom(event, transcript)
  if (!turn) { if (config.debug) log('queue skipped: no usable turn in the transcript'); return }
  const batch = enqueue(dataDir(), turn, config.queue, hookHost(process.env, transcript ?? undefined))
  if (config.debug) log(`queued turn ${batch.turns.length}/${config.queue.turns}, ${batch.chars}/${config.queue.chars} chars`)
  if (isDue(batch, config.queue, Date.now())) flushDue(event, config, turn.scope)
}

/** Takes whatever is ready and hands it to a detached child. */
function flushDue(event: HookEvent, config: HookConfig, scope?: MemoryScope): void {
  const due = takeDue(dataDir(), config.queue, Date.now(), scope)
  if (!due.length) return
  if (config.debug) log(`flushing ${due.length} batch(es), ${due.reduce((sum, batch) => sum + batch.turns.length, 0)} turns`)
  detachFlush(due, event)
}

/** Reflection takes seconds; the hook must not. The batches are already taken,
    so nothing is distilled twice even if the child is slow or dies. */
function detachFlush(batches: QueuedBatch[], event: HookEvent): void {
  const dir = mkdtempSync(join(tmpdir(), 'evo-hook-'))
  const payloadPath = join(dir, 'flush.json')
  writeFileSync(payloadPath, JSON.stringify({ batches, sessionId: event.session_id }))
  spawn(process.execPath, [selfPath, 'flush', payloadPath], { detached: true, stdio: 'ignore' }).unref()
}

async function runDetachedFlush(payloadPath: string, config: HookConfig): Promise<void> {
  const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as { batches: QueuedBatch[] }
  rmSync(dirname(payloadPath), { recursive: true, force: true })
  const { service, store } = openService()
  const total: MemoryDelta = { created: [], updated: [], deleted: [] }
  let firstError: string | undefined
  try {
    for (const batch of payload.batches ?? []) {
      service.setModelRunner(modelRunner(batch.host, config))
      try {
        const result = await service.reflectBatch(batchTurns(batch))
        const delta = result.memories
        total.created.push(...delta.created); total.updated.push(...delta.updated); total.deleted.push(...delta.deleted)
        if (config.debug) log(`reflect ok host=${batch.host} turns=${batch.turns.length} created=${delta.created.length} updated=${delta.updated.length} evicted=${delta.deleted.length}`)

        await runSlowPath(service, batch.scope, config)
      } catch (error) {
        const reason = String(error instanceof Error ? error.message : error)
        log(`ERROR reflect failed for ${batch.turns.length} turn(s): ${reason}`)
        if (!firstError) firstError = reason
      }
    }
    if (config.notify) {
      if (firstError) {
        writeError(dataDir(), firstError)
      } else {
        writeNotice(dataDir(), total)
      }
    }
  } finally {
    store.close?.()
  }
}

/** Run slow-path maintenance: auto-consolidate, enforce capacity, dormancy, polish. */
async function runSlowPath(service: EvoService, scope: MemoryScope, config: HookConfig): Promise<void> {
  try {
    const consolidateCheck = await service.shouldAutoConsolidate(scope)
    if (consolidateCheck.shouldConsolidate) {
      if (config.debug) log(`auto-consolidate triggered: ${consolidateCheck.reason}, replay=${consolidateCheck.replaySize}, hours=${consolidateCheck.hoursSinceLastConsolidate.toFixed(1)}`)
      const result = await service.autoConsolidate(scope)
      if (result?.result && config.debug) {
        log(`auto-consolidate ok: ${result.result.before} -> ${result.result.after} memories, converged=${result.converged}`)
      }
    }

    const evicted = await service.enforceCapacity(scope)
    if (evicted.length && config.debug) {
      log(`capacity enforcement evicted ${evicted.length} memories`)
    }

    const dormant = await service.processDormancy(scope)
    if (dormant.length && config.debug) {
      log(`dormancy: ${dormant.length} skills made dormant`)
    }

    const polished = await service.processPolish(scope)
    if (polished.length && config.debug) {
      for (const p of polished) {
        log(`polish ${p.skill}: ${p.result.polished ? 'ok' : p.result.error}`)
      }
    }
  } catch (error) {
    log(`ERROR slow-path failed: ${String(error instanceof Error ? error.message : error)}`)
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
