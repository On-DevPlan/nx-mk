/**
 * 错误体系 —— KernelError 统一错误类型与「错误码 → 进程退出码」映射
 *
 * 内核所有可预期错误都包装为携带机器可读 ErrorCode 的 KernelError；
 * CLI 顶层捕获后调用 mapErrorCodeToExit 设置进程退出码：
 * 2=配置错误、3=插件加载错误、4=插件钩子错误、5=内核内部错误。
 */

// 错误码按错误来源分类，决定最终的进程退出码
export type ErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'PLUGIN_LOAD_FAILED'
  | 'PLUGIN_SHAPE_INVALID'
  | 'PLUGIN_HOOK_FAILED'
  | 'KERNEL_INTERNAL'

// 内核统一错误类：code 供程序化判断与退出码映射，cause 保留原始错误便于排查
export class KernelError extends Error {
  readonly code: ErrorCode
  override readonly cause?: unknown
  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'KernelError'
    this.code = code
    this.cause = cause
  }
}

// 错误码 → 进程退出码映射；1 为兜底（未分类错误），见 CLI 顶层 catch
export function mapErrorCodeToExit(code: ErrorCode | undefined): 1 | 2 | 3 | 4 | 5 {
  switch (code) {
    // 配置类：文件缺失或内容非法 → 退出码 2
    case 'CONFIG_NOT_FOUND':
    case 'CONFIG_INVALID':
      return 2
    // 插件加载类：动态 import 失败或插件结构非法 → 退出码 3
    case 'PLUGIN_LOAD_FAILED':
    case 'PLUGIN_SHAPE_INVALID':
      return 3
    // 插件钩子执行期抛错 → 退出码 4
    case 'PLUGIN_HOOK_FAILED':
      return 4
    // 内核自身缺陷 → 退出码 5
    case 'KERNEL_INTERNAL':
      return 5
    default:
      return 1
  }
}