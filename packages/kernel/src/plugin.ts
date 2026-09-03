/**
 * 插件合约 —— Plugin / PluginContext / KernelAPI 等类型定义
 *
 * 插件是由 npm 包导出的工厂函数创建的普通对象（name + version + hooks）；
 * 内核通过 PluginContext 向钩子注入最终配置、日志器、事件总线和内核句柄。
 *
 * M2：插件可声明 configSchema（standard-schema 规范）做配置校验，
 * 由 @nx-mk/schema 包的 validateConfig 处理。
 */
import type { Logger } from './logger'
import type { EventBus } from './event-bus'
import type {
  Coverage,
  MissingItem,
  Phase,
  PluginReport,
  PluginSignal,
  ResolvedConfig,
  KernelState,
  RunId,
} from './types'
import type { StandardSchemaV1 } from '@nx-mk/schema'

// 钩子名 = 阶段名 × 时机：before{Phase} / after{Phase}（如 beforeRun / afterRun）
// 不含裸 phase 名：phase 本身的内核默认行为由内核控制，不向插件暴露钩子点。
// 插件如需在阶段内做事，使用 after<Phase>（如 afterRun、afterShutdown）。
export type HookName =
  | `before${Capitalize<Phase>}`
  | `after${Capitalize<Phase>}`

// 钩子签名：接收上下文，可同步可异步，返回 void（钩子间通过事件/日志通信）
export type HookHandler = (ctx: PluginContext) => Promise<void> | void

// 插件可实现的所有钩子（全部可选，按需声明）
export type PluginHooks = {
  [K in HookName]?: HookHandler
}

// 插件对象结构：由插件包工厂函数返回，内核据此注册与调度
export interface Plugin {
  name: string
  version: string
  hooks: PluginHooks
  // M2：可选配置 schema（standard-schema 规范）。
  // 声明后，loadPlugins 会调用 @nx-mk/schema 的 validateConfig 校验 rawConfig。
  // 校验失败抛 PLUGIN_CONFIG_INVALID 错误。不声明时跳过校验（向后兼容）。
  configSchema?: StandardSchemaV1<unknown, unknown>
  // M3：声明式依赖注入。inject 列出插件需要的服务名（其他插件的 provide）。
  // 不声明 inject 的旧插件继续工作（向后兼容）。
  inject?: string[]
  // M3：声明此插件对外提供的服务名（被其他插件的 inject 引用）。
  provide?: string[]
}

// 核心服务常量（M3 引入）—— 这些服务由内核直接注入到 PluginContext，
// 无需在 inject 中显式声明（向后兼容）。
// 显式声明 inject 时，这些名字依然会被识别（不视为外部依赖）。
export const CORE_SERVICES = ['logger', 'events', 'kernel', 'config', 'cwd'] as const
export type CoreService = typeof CORE_SERVICES[number]

// run() 的返回值：运行 ID 与总耗时
export interface RunResult {
  runId: RunId
  durationMs: number
}

// 内核对外的控制接口：run 驱动生命周期，shutdown 手动关停，其余为只读查询
export interface KernelAPI {
  run(): Promise<RunResult>
  shutdown(reason?: string): Promise<void>
  getState(): KernelState
  getRunId(): RunId
  getSubcommand(): 'run' | 'init' | 'doctor'
}

// 插件钩子收到的上下文：插件通过它读配置、写日志、订阅事件、回调内核
export interface PluginContext {
  config: ResolvedConfig
  logger: Logger
  events: EventBus
  kernel: KernelAPI
  cwd: string                       // ← NEW: 内核运行的工作目录（Phase 1 引入）
  signal?: AbortSignal              // ← M14：Goal Loop 终止信号
  // M14：Goal Loop 报告 / 信号 API
  emitReport(report: PluginReport): void
  emitSignal(signal: PluginSignal): void
  getTurn(): number
  getCoverage(): Coverage
  getMissing(): MissingItem[]
}
