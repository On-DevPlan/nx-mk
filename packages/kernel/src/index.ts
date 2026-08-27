/**
 * @nx-mk/kernel 公共 API 入口 —— 统一重导出微内核的全部对外接口
 *
 * 外部消费方（CLI、插件、测试）只从本入口导入，不直接引用内部模块路径，
 * 因此内核内部文件可以自由重组而不会破坏下游。
 */
// Public API of @nx-mk/kernel
// —— 共享类型与常量：生命周期阶段、日志级别、运行 ID、配置结构
export type {
  Phase,
  LogLevel,
  RunId,
  Config,
  ResolvedConfig,
  KernelState,
} from './types'
export { PHASES, makeRunId } from './types'

// —— 错误体系：KernelError 与「错误码 → 进程退出码」映射（CLI 依赖后者设置退出码）
export type { ErrorCode } from './errors'
export { KernelError, mapErrorCodeToExit } from './errors'

// —— 事件总线：类型化内核事件的发布/订阅（可持久化为 events.jsonl）
export type { KernelEvent } from './event-bus'
export { EventBus } from './event-bus'

// —— 日志器：NDJSON 结构化日志工厂
export type { Logger, LoggerOptions } from './logger'
export { createLogger } from './logger'

// —— 插件合约：Plugin / 钩子 / PluginContext / KernelAPI 等类型
export type {
  HookName,
  HookHandler,
  PluginHooks,
  Plugin,
  PluginContext,
  KernelAPI,
  RunResult,
} from './plugin'

// —— 内核本体：createKernel 工厂，驱动 5 阶段生命周期
export type { CreateKernelOptions } from './kernel'
export { createKernel } from './kernel'

// —— 插件加载：按配置动态 import npm 插件包并做结构校验
export type { LoadPluginsOptions } from './plugin-registry'
export { loadPlugins } from './plugin-registry'

// —— 钩子执行器：fail-fast 串行执行插件钩子
export { runHook, runHooksForPhase } from './hooks'
