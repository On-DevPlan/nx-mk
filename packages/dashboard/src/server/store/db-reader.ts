/**
 * coverage.db 只读连接（spec §3.1）：绝不做任何 DDL/写操作——
 * 不复用 CoverageDb（其构造即建表 + ensureColumn ALTER，写语义）。
 * WAL（Phase 2 既有）下与写入方并发安全；busy 超时映射 DbBusyError（路由层 → 503）。
 */
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { Statement as SqliteStatement } from 'better-sqlite3'

export const BUSY_TIMEOUT_MS = 2000

export interface CoverageDbReader {
  all<T>(sql: string, ...params: unknown[]): T[]
  get<T>(sql: string, ...params: unknown[]): T | undefined
  close(): void
}

/** SQLITE_BUSY（写入方持锁超 busy_timeout）——路由层映射 503（spec §4） */
export class DbBusyError extends Error {
  constructor(cause: unknown) {
    super('coverage.db busy — run in progress')
    this.name = 'DbBusyError'
    this.cause = cause
  }
}

export interface OpenReaderOptions {
  busyTimeoutMs?: number
}

export function openReader(dbPath: string, opts: OpenReaderOptions = {}): CoverageDbReader | null {
  if (!existsSync(dbPath)) return null
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch {
    return null // 文件损坏/权限等——按降级处理（spec §4），不抛
  }
  db.pragma(`busy_timeout = ${opts.busyTimeoutMs ?? BUSY_TIMEOUT_MS}`)
  // better-sqlite3 构造惰性不校验文件格式，非 sqlite 文件首条语句才抛 SQLITE_NOTADB——探针一次读以判降级（spec §4）；
  // 探针撞上写入方持锁（SQLITE_BUSY）则放行：连接本身有效，busy 语义留给后续查询抛 DbBusyError（路由层 → 503）
  try {
    db.prepare('SELECT 1').get()
  } catch (err) {
    if ((err as { code?: string }).code !== 'SQLITE_BUSY') {
      db.close()
      return null // 非锁类打开失败——按降级处理，不抛
    }
  }
  const guard = <T>(fn: () => T): T => {
    try {
      return fn()
    } catch (err) {
      if ((err as { code?: string }).code === 'SQLITE_BUSY') throw new DbBusyError(err)
      throw err
    }
  }
  return {
    all<T>(sql: string, ...params: unknown[]): T[] {
      return guard(() => (db.prepare(sql) as SqliteStatement).all(...params) as T[])
    },
    get<T>(sql: string, ...params: unknown[]): T | undefined {
      return guard(() => (db.prepare(sql) as SqliteStatement).get(...params) as T | undefined)
    },
    close(): void {
      db.close()
    },
  }
}
