/**
 * Console-based logger with structured bindings support.
 *
 * Plugins should always receive a child logger via `ctx.logger.child({ plugin: name })`
 * so log lines can be attributed to a source.
 */

import type { Logger } from './types.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface ConsoleLoggerOptions {
  /** Minimum level to emit. Default: 'info'. */
  level?: LogLevel
  /** Optional sink (defaults to stdout/stderr). */
  sink?: (line: string) => void
  /** Optional prefix prepended to every message. */
  prefix?: string
}

export class ConsoleLogger implements Logger {
  private readonly level: LogLevel
  private readonly sink: (line: string) => void
  private readonly bindings: Record<string, unknown>

  constructor(options: ConsoleLoggerOptions = {}, bindings: Record<string, unknown> = {}) {
    this.level = options.level ?? 'info'
    this.sink =
      options.sink ??
      ((line) => {
        // eslint-disable-next-line no-console
        console.log(line)
      })
    this.bindings = bindings
  }

  debug(msg: string, ...args: unknown[]): void {
    this.emit('debug', msg, args)
  }

  info(msg: string, ...args: unknown[]): void {
    this.emit('info', msg, args)
  }

  warn(msg: string, ...args: unknown[]): void {
    this.emit('warn', msg, args)
  }

  error(msg: string, ...args: unknown[]): void {
    this.emit('error', msg, args)
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({ level: this.level, sink: this.sink }, { ...this.bindings, ...bindings })
  }

  private emit(level: LogLevel, msg: string, args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) return

    const ts = new Date().toISOString()
    const bindingStr =
      Object.keys(this.bindings).length > 0
        ? ' ' +
            Object.entries(this.bindings)
              .map(([k, v]) => `${k}=${stringifyValue(v)}`)
              .join(' ')
        : ''

    const line = `[${ts}] [${level.toUpperCase()}]${bindingStr} ${msg}`
    this.sink(line)
    if (args.length > 0) {
      this.sink(stringifyValue(args))
    }
  }
}

function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ''}`
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Convenience factory. */
export function createLogger(options?: ConsoleLoggerOptions): Logger {
  return new ConsoleLogger(options)
}