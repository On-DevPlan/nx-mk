/**
 * 插件合约 —— Plugin / PluginContext / KernelAPI 等类型定义
 *
 * 插件是由 npm 包导出的工厂函数创建的普通对象（name + version + hooks）；
 * 内核通过 PluginContext 向钩子注入最终配置、日志器、事件总线和内核句柄。
 */
import type { Logger } from './logger'
import type { EventBus } from './event-bus'
import type { Phase, ResolvedConfig, KernelState, RunId } from './types'

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
}

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
}
