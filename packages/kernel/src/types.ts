/**
 * 共享类型 —— Phase / RunId / Config / ResolvedConfig / KernelState
 *
 * 微内核各模块共用的基础类型定义。Config 是 nx-mk.config.yml 的字段形状，
 * ResolvedConfig 是叠加环境变量与 CLI 覆盖、并补全运行期字段后的最终配置。
 */
import type { ErrorCode } from './errors'

// 5 个生命周期阶段，严格按声明顺序执行
export type Phase = 'loadConfig' | 'resolvePlugins' | 'initPlugins' | 'run' | 'shutdown'

// 阶段的规范顺序常量（供遍历与顺序校验使用）
export const PHASES: readonly Phase[] = [
  'loadConfig',
  'resolvePlugins',
  'initPlugins',
  'run',
  'shutdown',
] as const

// 日志级别；silent 屏蔽全部常规输出（error.log 镜像除外，见 logger.ts）
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

// 品牌类型（branded type）：普通字符串必须经 makeRunId 标记才是合法 RunId，防止误传
export type RunId = string & { readonly __brand: 'RunId' }

// 把普通字符串标记为 RunId（运行时无任何转换，仅类型层面收窄）
export function makeRunId(s: string): RunId {
  return s as RunId
}

// 品牌类型：插件名（仅类型层面收窄，运行时与 string 等价）
export type PluginName = string & { readonly __brand: 'PluginName' }

// 把普通字符串标记为 PluginName（运行时无任何转换，仅类型层面收窄）
export function makePluginName(s: string): PluginName {
  return s as PluginName
}

/**
 * assertNever —— 判别联合 switch 的编译期+运行期收尾保护（M5）
 *
 * 用法：在对判别联合（discriminated union）的 switch 末尾调用，
 * 让 TypeScript 强制要求所有 union 成员都被处理。
 *
 * 编译期：`x: never` 表示"如果还有未被 switch 处理的 union 变体，这里会编译错误"。
 * 运行期：若意外走到该分支（说明代码与类型契约不一致），抛出明确错误。
 *
 * @example
 * ```ts
 * type Event = { type: 'a' } | { type: 'b' }
 * function handle(e: Event) {
 *   switch (e.type) {
 *     case 'a': ...; break
 *     case 'b': ...; break
 *     default: assertNever(e)  // ← 若新增 'c' 变体但未处理，编译失败
 *   }
 * }
 * ```
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}

/**
 * 插件 lifecycle 状态机（M1 引入）
 *
 * 每个插件在生命周期内会经历的状态：
 * - active: 已加载并参与后续阶段
 * - done: 主动声明完成（如 emitSignal({ kind: 'done' })）
 * - failed: 加载或钩子执行失败
 *
 * 预留状态（M2+ 启用）：
 * - pending: 等待依赖满足
 * - loading: 正在加载（异步加载场景）
 * - unloading: 正在清理（shutdown 阶段）
 * - disposed: 已彻底移除（M8 reloadPlugin 用）
 *
 * 注：本里程碑仅启用 active / done / failed；其他状态先在类型上保留以备扩展。
 */
export type PluginWorkerState =
  | { kind: 'active'; activatedAt: string }
  | { kind: 'done'; reason: string; finishedAt: string }
  | { kind: 'failed'; error: { code: string; message: string }; failedAt: string }
  | { kind: 'pending'; waitedFor: string[] }
  | { kind: 'loading' }
  | { kind: 'unloading' }
  | { kind: 'disposed' }

// nx-mk.config.yml 的字段结构（对应 @nx-mk/config 中 Zod schema 的解析结果）
export interface Config {
  plugins: string[]
  logLevel: LogLevel
  outputDir: string
  // openapi: 指向 OpenAPI 3.x 文档的相对/绝对路径（Phase 1；未配置则为 undefined）
  openapi?: string
  // M14：可选 Goal Loop 配置（不设置则使用 push-based beforeRun/afterRun）
  goal?: GoalConfig
}

// 合并 env / CLI 覆盖后的最终配置，附带运行期上下文字段（configPath、runId 等）
export interface ResolvedConfig extends Config {
  configPath: string
  runId: RunId
  envOverrides: Partial<Config>
  cliOverrides: Partial<Config>
  subcommand: 'run' | 'init' | 'doctor'
}

// 内核运行时可观测状态（外部通过 KernelAPI.getState() 读取快照）
export interface KernelState {
  runId: RunId
  currentPhase: Phase | null
  startedAt: string
  // 旧字段：仅保留插件名列表（向后兼容，M1 期间不删除）
  loadedPlugins: string[]
  // 新字段（M1）：每个插件的 lifecycle 状态
  pluginStates: Map<PluginName, PluginWorkerState>
  // M14：Goal Loop 收集的覆盖率报告（按 turn 聚合）
  reports?: PluginReport[]
  // M14：Goal Loop 终态（run 阶段完成后填充）
  collectionResult?: GoalResult
  error?: { code: ErrorCode; message: string }
}

// =====================================================================
// Goal-Oriented Multi-Turn Loop（M14 引入）
// 设计依据：docx/plan/2026-08-28-goal-oriented-loop-design.md
// 模式：多生产者（plugins emit reports） + 协调者（kernel 计算覆盖率）
// + 目标驱动终止（goal-met / max-turns / idle / timeout / aborted）
// =====================================================================

/**
 * 覆盖率模型：以 initial missing items 为全集，从 reports 中提取已覆盖项。
 */
export interface Coverage {
  total: number
  covered: number
  ratio: number                 // covered / total
  missing: MissingItem[]
}

export type MissingItem =
  | { kind: 'endpoint'; method: string; path: string }
  | { kind: 'route'; route: string; component?: string }
  | { kind: 'field'; fieldId: string }
  | { kind: 'schema'; path: string }

/**
 * Goal 终止配置 —— 所有字段必填，调用方用 DEFAULT_GOAL_CONFIG 简化构造。
 */
export interface GoalConfig {
  /** 目标覆盖率（默认 1.0 = 100%） */
  targetRatio: number
  /** 最大 turn 数（默认 100） */
  maxTurns: number
  /** 连续无进展 turn 数上限（默认 3） */
  idleTurnsLimit: number
  /** 整体超时（默认 600000ms = 10 分钟） */
  absoluteTimeoutMs: number
}

export const DEFAULT_GOAL_CONFIG: GoalConfig = {
  targetRatio: 1.0,
  maxTurns: 100,
  idleTurnsLimit: 3,
  absoluteTimeoutMs: 600_000,
}

/**
 * Plugin 上报的覆盖率贡献（M14 Plugin API）
 */
export type PluginReport =
  | { kind: 'endpoint-called'; method: string; path: string; turn: number }
  | { kind: 'route-visited'; route: string; turn: number }
  | { kind: 'field-hit'; fieldId: string; count: number; turn: number }
  | { kind: 'no-data'; reason: string; turn: number }
  | { kind: 'analysis'; missing: MissingItem[]; recommendations: string[]; turn: number }

/**
 * Plugin 完成信号（M14 Plugin API）
 */
export type PluginSignal =
  | { kind: 'idle'; turn: number }
  | { kind: 'done'; reason: 'all-collected' | 'timeout'; turn: number }
  | { kind: 'failed'; error: { code: string; message: string }; turn: number }

/**
 * Goal Loop 终态（M14）
 */
export interface GoalResult {
  kind: 'met' | 'unmet' | 'aborted'
  coverage: Coverage
  turns: number
  durationMs: number
  reports: PluginReport[]
  terminatedBy: 'goal-met' | 'max-turns' | 'idle' | 'timeout' | 'aborted' | 'all-failed'
}