export type ErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'PLUGIN_LOAD_FAILED'
  | 'PLUGIN_SHAPE_INVALID'
  | 'PLUGIN_HOOK_FAILED'
  | 'KERNEL_INTERNAL'

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

export function mapErrorCodeToExit(code: ErrorCode | undefined): 1 | 2 | 3 | 4 | 5 {
  switch (code) {
    case 'CONFIG_NOT_FOUND':
    case 'CONFIG_INVALID':
      return 2
    case 'PLUGIN_LOAD_FAILED':
    case 'PLUGIN_SHAPE_INVALID':
      return 3
    case 'PLUGIN_HOOK_FAILED':
      return 4
    case 'KERNEL_INTERNAL':
      return 5
    default:
      return 1
  }
}