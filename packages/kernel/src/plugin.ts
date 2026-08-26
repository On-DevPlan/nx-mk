import type { Logger } from './logger'
import type { EventBus } from './event-bus'
import type { Phase, ResolvedConfig, KernelState, RunId } from './types'

export type HookName =
  | `before${Capitalize<Phase>}`
  | Phase
  | `after${Capitalize<Phase>}`

export type HookHandler = (ctx: PluginContext) => Promise<void> | void

export type PluginHooks = {
  [K in HookName]?: HookHandler
}

export interface Plugin {
  name: string
  version: string
  hooks: PluginHooks
}

export interface RunResult {
  runId: RunId
  durationMs: number
}

export interface KernelAPI {
  run(): Promise<RunResult>
  shutdown(reason?: string): Promise<void>
  getState(): KernelState
  getRunId(): RunId
  getSubcommand(): 'run' | 'init' | 'doctor'
}

export interface PluginContext {
  config: ResolvedConfig
  logger: Logger
  events: EventBus
  kernel: KernelAPI
}
