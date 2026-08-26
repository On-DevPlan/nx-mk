import type { ErrorCode } from './errors'

export type Phase = 'loadConfig' | 'resolvePlugins' | 'initPlugins' | 'run' | 'shutdown'

export const PHASES: readonly Phase[] = [
  'loadConfig',
  'resolvePlugins',
  'initPlugins',
  'run',
  'shutdown',
] as const

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export type RunId = string & { readonly __brand: 'RunId' }

export function makeRunId(s: string): RunId {
  return s as RunId
}

export interface Config {
  plugins: string[]
  logLevel: LogLevel
  outputDir: string
}

export interface ResolvedConfig extends Config {
  configPath: string
  runId: RunId
  envOverrides: Partial<Config>
  cliOverrides: Partial<Config>
  subcommand: 'run' | 'init' | 'doctor'
}

export interface KernelState {
  runId: RunId
  currentPhase: Phase | null
  startedAt: string
  loadedPlugins: string[]
  error?: { code: ErrorCode; message: string }
}