import { appendFileSync } from 'node:fs'
import type { LogLevel } from './types'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  flush(): Promise<void>
}

export interface LoggerOptions {
  runId: string
  logLevel: LogLevel
  logFile: string
  errorFile?: string
  stderr?: (line: string) => void
}

interface PendingWrite {
  path: string
  line: string
}

export function createLogger(opts: LoggerOptions): Logger {
  const threshold = LEVEL_PRIORITY[opts.logLevel]
  const writeStderr =
    opts.stderr ?? ((line: string) => process.stderr.write(line + '\n'))
  const pending: PendingWrite[] = []
  const writeBuffer: string[] = []
  // Ensure kernel.log exists (empty) so logLevel=silent still leaves a queryable file
  try {
    appendFileSync(opts.logFile, '', 'utf8')
  } catch {
    // ignore — flush will surface real write errors
  }

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
