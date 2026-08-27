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

// nx-mk.config.yml 的字段结构（对应 @nx-mk/config 中 Zod schema 的解析结果）
export interface Config {
  plugins: string[]
  logLevel: LogLevel
  outputDir: string
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
  loadedPlugins: string[]
  error?: { code: ErrorCode; message: string }
}