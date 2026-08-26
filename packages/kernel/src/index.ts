// Public API of @nx-mk/kernel
export type {
  Phase,
  LogLevel,
  RunId,
  Config,
  ResolvedConfig,
  KernelState,
} from './types'
export { PHASES, makeRunId } from './types'

export type { ErrorCode } from './errors'
export { KernelError, mapErrorCodeToExit } from './errors'

export type { KernelEvent } from './event-bus'
export { EventBus } from './event-bus'

export type { Logger, LoggerOptions } from './logger'
export { createLogger } from './logger'

export type {
  HookName,
  HookHandler,
  PluginHooks,
  Plugin,
  PluginContext,
  KernelAPI,
  RunResult,
} from './plugin'

export type { CreateKernelOptions } from './kernel'
export { createKernel } from './kernel'

export type { LoadPluginsOptions } from './plugin-registry'
export { loadPlugins } from './plugin-registry'

export { runHook, runHooksForPhase } from './hooks'
