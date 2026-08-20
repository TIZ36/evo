import { isCodexTranscript } from './codex-transcript.js'

/** The agent CLI whose hook is running. */
export type HookHost = 'claude' | 'codex'

/**
 * evo ships one hook bundle for both hosts, so it has to know which one invoked
 * it — the transcript is parsed differently and reflection is delegated to a
 * different CLI.
 *
 * The transcript decides when there is one: it is written by the host itself,
 * which no environment heuristic can beat. Codex also exports `PLUGIN_ROOT` and
 * `CODEX_HOME`, while Claude Code exports only its `CLAUDE_*` variables. An
 * explicit `EVO_HOOK_HOST` overrides everything, for hosts that later blur
 * those signals.
 */
export function hookHost(env: NodeJS.ProcessEnv = process.env, transcript?: string): HookHost {
  const declared = env.EVO_HOOK_HOST?.trim().toLowerCase()
  if (declared === 'codex' || declared === 'claude') return declared
  if (transcript?.trim()) return isCodexTranscript(transcript) ? 'codex' : 'claude'
  if (env.CODEX_HOME?.trim() || env.PLUGIN_ROOT?.trim()) return 'codex'
  return 'claude'
}
