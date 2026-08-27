/**
 * NDJSON 日志器 —— 结构化日志 + 按级别过滤 + 延迟批量落盘
 *
 * 日志先缓存在内存（pending / writeBuffer），flush() 时一次性追加写入：
 * kernel.log 为 NDJSON（每行一个 JSON 对象），stderr 输出人类可读格式。
 * error 级别日志始终额外镜像到 error.log，即使 logLevel=silent。
 */
import { appendFileSync } from 'node:fs'
import type { LogLevel } from './types'

// 级别 → 数值映射：数值越高优先级越高；silent 最高用于屏蔽全部常规输出
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

// 日志器接口：四个级别方法 + flush（内核在 shutdown 前必须调用 flush 落盘）
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  flush(): Promise<void>
}

// stderr 可注入用于测试；errorFile 可选，提供后 error 级别会镜像写入
export interface LoggerOptions {
  runId: string
  logLevel: LogLevel
  logFile: string
  errorFile?: string
  stderr?: (line: string) => void
}

// 待落盘的一条日志（目标文件路径 + JSON 行）
interface PendingWrite {
  path: string
  line: string
}

// 日志器工厂：返回带级别过滤与批量缓冲的 Logger 实例
export function createLogger(opts: LoggerOptions): Logger {
  // 当前级别阈值：低于阈值的日志不进 kernel.log / stderr
  const threshold = LEVEL_PRIORITY[opts.logLevel]
  const writeStderr =
    opts.stderr ?? ((line: string) => process.stderr.write(line + '\n'))
  // 待写文件队列（kernel.log + error.log）与待写 stderr 队列
  const pending: PendingWrite[] = []
  const writeBuffer: string[] = []
  // Ensure kernel.log exists (empty) so logLevel=silent still leaves a queryable file
  // 中文：预先创建空的 kernel.log，保证 logLevel=silent 时文件依然存在可查询
  try {
    appendFileSync(opts.logFile, '', 'utf8')
  } catch {
    // ignore — flush will surface real write errors
  }

  // 组装一条 NDJSON 日志并入队：error 恒写 error.log，达到阈值的才写 kernel.log + stderr
  function emit(level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      runId: opts.runId,
      msg,
      ...(meta ? { meta } : {}),
    }
    const line = JSON.stringify(entry)
    // Always mirror errors to errorFile even when logLevel=silent
    if (level === 'error' && opts.errorFile) {
      pending.push({ path: opts.errorFile, line })
    }
    // Kernel log + stderr respect the threshold
    if (LEVEL_PRIORITY[level] >= threshold) {
      pending.push({ path: opts.logFile, line })
      writeBuffer.push(formatStderr(entry))
    }
  }

  // flush 逻辑：一次性取空两个缓冲队列，逐条追加写文件、合并写 stderr。
  // 单条写入失败时降级输出到 stderr，避免日志静默丢失。
  async function flush(): Promise<void> {
    while (pending.length > 0) {
      const batch = pending.splice(0, pending.length)
      // Serialize via appendFileSync (kernel writes are sequential)
      for (const w of batch) {
        try {
          appendFileSync(w.path, w.line + '\n', 'utf8')
        } catch (err) {
          // Last-resort: mirror to stderr so we don't lose the line silently
          process.stderr.write(`[logger-fail] ${(err as Error).message}\n`)
        }
      }
    }
    while (writeBuffer.length > 0) {
      const chunk = writeBuffer.splice(0, writeBuffer.length).join('')
      writeStderr(chunk)
    }
  }

  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => {
      const norm = normalizeErrorMeta(meta)
      emit('error', m, norm)
    },
    flush,
  }
}

// 把 meta 中的 Error 实例序列化为 { message, stack }，保证 JSON.stringify 可用
function normalizeErrorMeta(
  meta?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!meta) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Error) {
      out[k] = { message: v.message, stack: v.stack }
    } else {
      out[k] = v
    }
  }
  return out
}

// 格式化为人类可读的 stderr 单行：[HH:MM:SS.mmm] LEVEL message k=v k=v
function formatStderr(entry: {
  ts: string
  level: string
  runId: string
  msg: string
  meta?: Record<string, unknown>
}): string {
  const time = entry.ts.split('T')[1]?.replace('Z', '') ?? entry.ts
  const lvl = entry.level === 'error' ? 'ERROR' : entry.level.padEnd(5)
  const metaStr =
    entry.meta && Object.keys(entry.meta).length > 0
      ? ' ' +
        Object.entries(entry.meta)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' ')
      : ''
  return `[${time}] ${lvl} ${entry.msg}${metaStr}`
}
