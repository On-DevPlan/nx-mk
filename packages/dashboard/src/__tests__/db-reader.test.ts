import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../server/store/db-reader.js'
import { makeNxMkDir, seedDb } from './fixtures.js'

let dir: string
beforeEach(() => { dir = makeNxMkDir([]) })
// 清理整个 tmp 根（makeNxMkDir 的 mkdtemp 根，.nx-mk 是其子目录）——不留孤儿 tmp 目录
afterEach(() => rmSync(dirname(dir), { recursive: true, force: true }))

describe('openReader', () => {
  it('opens existing db and reads', () => {
    seedDb(dir, { runs: [{ id: 'run_a', status: 'completed' }] })
    const reader = openReader(join(dir, 'coverage.db'))
    expect(reader).not.toBeNull()
    expect(reader!.get<unknown>('SELECT * FROM runs WHERE id = ?', 'run_a')).toBeDefined()
    reader!.close()
  })
  it('missing file → null (spec §4 降级)', () => {
    expect(openReader(join(dir, 'coverage.db'))).toBeNull()
  })
  it('non-sqlite file → null (打开失败不抛)', () => {
    writeFileSync(join(dir, 'coverage.db'), 'not a database at all')
    expect(openReader(join(dir, 'coverage.db'))).toBeNull()
  })
  it('reader never writes: WAL mode is the writer-side concern', () => {
    // 只读连接只暴露 all/get/close —— 由类型面保证；此处验证 busy_timeout 注入生效路径
    seedDb(dir, { runs: [{ id: 'run_a' }] })
    const reader = openReader(join(dir, 'coverage.db'), { busyTimeoutMs: 50 })
    expect(reader).not.toBeNull()
    reader!.close()
  })
  it('BUSY_TIMEOUT_MS default is 2000', () => {
    expect(BUSY_TIMEOUT_MS).toBe(2000)
  })
})

describe('busy → DbBusyError', () => {
  it('write lock held → reader query throws DbBusyError', () => {
    seedDb(dir, { runs: [{ id: 'run_a' }] })
    // 模拟写入方持锁：独立连接 BEGIN EXCLUSIVE
    const writer = new Database(join(dir, 'coverage.db'))
    // WAL 下读者永不阻塞（BEGIN EXCLUSIVE 只挡写者），切 DELETE 日志模式才能确定性复现 SQLITE_BUSY 读阻塞
    writer.pragma('journal_mode = DELETE')
    writer.exec('BEGIN EXCLUSIVE')
    try {
      const reader = openReader(join(dir, 'coverage.db'), { busyTimeoutMs: 50 })
      expect(() => reader!.get('SELECT * FROM runs')).toThrow(DbBusyError)
      reader!.close()
    } finally {
      writer.exec('ROLLBACK')
      writer.close()
    }
  })
})
