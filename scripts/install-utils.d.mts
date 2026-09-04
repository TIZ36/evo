export interface Hook {
  type?: string
  command?: string
  timeout?: number
}

export interface HookGroup {
  hooks?: Hook[]
}

export interface Settings {
  hooks?: Record<string, HookGroup[]>
  [key: string]: unknown
}

export interface HookCount {
  count: number
  events: string[]
}

export interface StripResult {
  settings: Settings
  removed: number
}

export interface ProjectHooksResult {
  found: boolean
  path?: string
  count?: number
  events?: string[]
}

export interface CodexPluginInfo {
  selector: string
  enabled: boolean
  marketplaceName?: string
  version?: string
}

export function shellQuote(value: unknown): string
export function isEvoHook(hook: unknown): boolean
export function countEvoHooks(settings: unknown): HookCount
export function stripEvoHooks(settings: Settings): StripResult
export function addEvoHooks(settings: Settings, command: string, events: Record<string, { timeout: number }>): Settings
export function findClaudePlugin(claudeDir: string): string | null
export function findCodexPlugin(pluginList: unknown): CodexPluginInfo | null
export function findProjectClaudeHooks(cwd: string): ProjectHooksResult
export function findProjectCodexHooks(cwd: string): ProjectHooksResult
