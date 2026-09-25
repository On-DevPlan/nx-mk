/**
 * §24 响应隐私脱敏单测：maskResponsePreview 纯函数语义 + flushDrained 落库集成。
 * 默认（无 privacy 配置）= masked + 内置规则表；raw 透传；none 不落库。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maskResponsePreview, DEFAULT_MASK_RULES } from '../src/privacy/mask.js'
import { openCoverageDb } from '../src/db/client.js'
import type { PrivacyConfig } from '../src/privacy/mask.js'

describe('maskResponsePreview（§24 策略）', () => {
  it('缺省配置 = masked：email 键按 email 策略打码（对齐 Plan §24 示例 j***@gmail.com）', () => {
    const out = maskResponsePreview('{"id":"u1","email":"jane@gmail.com"}')
    expect(out).toBe('{"id":"u1","email":"j***@gmail.com"}')
  })

  it('缺省配置：嵌套路径命中（*.email 语义由 *email* 内置规则承担）、token/password 全遮', () => {
    const out = maskResponsePreview(
      '{"data":{"email":"a@b.com","token":"abc123def456","password":"p@ss","name":"张三"}}',
    )
    const parsed = JSON.parse(out) as { data: Record<string, string> }
    expect(parsed.data.email).toBe('a***@b.com')
    expect(parsed.data.token).toBe('***')
    expect(parsed.data.password).toBe('***')
    expect(parsed.data.name).toBe('张三')
  })

  it('缺省配置：phone 键 ≥8 位保前 3 后 4；非命中键原样', () => {
    const out = maskResponsePreview('{"phone":"13812345678","id":"u1"}')
    expect(out).toBe('{"phone":"138****5678","id":"u1"}')
  })

  it('自定义规则覆盖内置表：pattern 为 glob（* 跨层级）', () => {
    const cfg: PrivacyConfig = {
      responseValues: { mode: 'masked' },
      mask: [{ pattern: '*.city', strategy: 'full' }],
    }
    const out = maskResponsePreview('{"address":{"city":"杭州"},"email":"a@b.com"}', cfg)
    const parsed = JSON.parse(out) as { address: { city: string }; email: string }
    expect(parsed.address.city).toBe('***')
    expect(parsed.email).toBe('a@b.com')
  })

  it('mode=raw：原文透传（仍截断 ≤500）', () => {
    const body = '{"email":"a@b.com"}'
    expect(maskResponsePreview(body, { responseValues: { mode: 'raw' } })).toBe(body)
    const long = 'x'.repeat(600)
    expect(maskResponsePreview(long, { responseValues: { mode: 'raw' } })).toHaveLength(500)
  })

  it('mode=none：null（不落库）', () => {
    expect(maskResponsePreview('{"email":"a@b.com"}', { responseValues: { mode: 'none' } })).toBeNull()
  })

  it('截断残片（非合法 JSON）退化为字符串级脱敏：email / 11 位手机号', () => {
    const truncated = '{"email":"a@b.com","bio":"太长被截断的 500 字符残片... 13812345678'
    const out = maskResponsePreview(truncated)
    expect(out).not.toContain('a@b.com')
    expect(out).not.toContain('13812345678')
    expect(out).toContain('a***@b.com')
  })

  it('数组元素同规则打码；DEFAULT_MASK_RULES 覆盖 authorization', () => {
    const out = maskResponsePreview('{"list":[{"email":"x@y.com"},{"email":"z@w.com"}]}')
    expect(out).toBe('{"list":[{"email":"x***@y.com"},{"email":"z***@w.com"}]}')
    expect(DEFAULT_MASK_RULES.some((r) => r.pattern === '*authorization*')).toBe(true)
  })
})

describe('flushDrained × privacy（落库集成）', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-privacy-'))
    dbPath = join(dir, 'coverage.db')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  function flush(dbPath: string, preview?: string): void {
    const db = openCoverageDb(dbPath)
    try {
      db.insertRun('run_p', '2026-09-25T00:00:00Z', 'running')
      db.flushDrained({
        runId: 'run_p',
        hits: [],
        traces: [{ requestId: 't1', method: 'GET', url: '/a', ...(preview !== undefined ? { responsePreview: preview } : {}) }],
        evidence: [],
      })
    } finally { db.close() }
  }

  function readPreview(dbPath: string): string | null {
    const db = openCoverageDb(dbPath)
    try {
      const row = db.prepare('SELECT response_preview FROM request_traces WHERE trace_id=?').get('t1') as
        { response_preview: string | null }
      return row.response_preview
    } finally { db.close() }
  }

  it('缺省（未传 privacy）：email 落库前已被打码', () => {
    flush(dbPath, '{"email":"jane@gmail.com"}')
    expect(readPreview(dbPath)).toBe('{"email":"j***@gmail.com"}')
  })

  it('privacy.responseValues.mode=raw：原文落库', () => {
    const rawPath = join(dir, 'raw.db')
    const db = openCoverageDb(rawPath, { responseValues: { mode: 'raw' } })
    try {
      db.insertRun('run_raw', '2026-09-25T00:00:00Z', 'running')
      db.flushDrained({
        runId: 'run_raw',
        hits: [],
        traces: [{ requestId: 'w1', method: 'GET', url: '/c', responsePreview: '{"email":"a@b.com"}' }],
        evidence: [],
      })
      const row = db.prepare('SELECT response_preview FROM request_traces WHERE trace_id=?').get('w1') as
        { response_preview: string }
      expect(row.response_preview).toBe('{"email":"a@b.com"}')
    } finally { db.close() }
  })

  it('privacy.responseValues.mode=none：落库为 NULL', () => {
    const db = openCoverageDb(dbPath, { responseValues: { mode: 'none' } })
    try {
      db.insertRun('run_q', '2026-09-25T00:00:00Z', 'running')
      db.flushDrained({
        runId: 'run_q',
        hits: [],
        traces: [{ requestId: 'q1', method: 'GET', url: '/b', responsePreview: '{"email":"a@b.com"}' }],
        evidence: [],
      })
      const row = db.prepare('SELECT response_preview FROM request_traces WHERE trace_id=?').get('q1') as
        { response_preview: null }
      expect(row.response_preview).toBeNull()
    } finally { db.close() }
  })

  it('无 responsePreview 的 trace：仍落 NULL（脱敏层不产假数据）', () => {
    flush(dbPath)
    expect(readPreview(dbPath)).toBeNull()
  })
})
