/**
 * SQLite db 单测（spec §3.3 / Plan §25）：9 张表 DDL、WAL、事务 flush、读回。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '../src/db/client.js'
import { TABLE_NAMES } from '../src/db/schema.js'

let dir: string
let dbPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-mk-cov-'))
  dbPath = join(dir, 'coverage.db')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('schema（§25 逐字）', () => {
  it('创建全部 9 张表', () => {
    const db = openCoverageDb(dbPath)
    try {
      expect(TABLE_NAMES).toEqual([
        'runs', 'endpoints', 'manifest_fields', 'request_traces', 'request_fields',
        'field_hits', 'ui_evidence', 'coverage_fields', 'agent_iterations',
      ])
      for (const t of TABLE_NAMES) {
        const cols = db.pragma(`table_info(${t})`) as { name: string }[]
        expect(cols.length).toBeGreaterThan(0)
      }
      // 关键列抽查（§25 逐字性）
      const traceCols = (db.pragma('table_info(request_traces)') as { name: string }[]).map((c) => c.name)
      expect(traceCols).toEqual(expect.arrayContaining(['id', 'run_id', 'trace_id', 'scenario_id', 'dsl_step_id', 'endpoint_id', 'method', 'url', 'path', 'status', 'duration_ms', 'started_at', 'ended_at', 'replayable', 'replay_safety', 'replay_reason']))
      const evCols = (db.pragma('table_info(ui_evidence)') as { name: string }[]).map((c) => c.name)
      expect(evCols).toEqual(expect.arrayContaining(['id', 'run_id', 'request_id', 'field_id', 'field_path', 'evidence_type', 'selector', 'visible', 'in_viewport', 'route', 'screenshot_path']))
    } finally { db.close() }
  })

  it('WAL 模式开启', () => {
    const db = openCoverageDb(dbPath)
    try { expect(db.journalMode).toBe('wal') } finally { db.close() }
  })

  it('幂等重开', () => {
    openCoverageDb(dbPath).close()
    openCoverageDb(dbPath).close()
  })
})

describe('insertRun / endRun / flush 读回', () => {
  it('flushDrained 一个事务写 3 类数据并可读回', () => {
    const db = openCoverageDb(dbPath)
    try {
      db.insertRun('run_x', '2026-09-16T00:00:00Z', 'running')
      db.flushDrained({
        runId: 'run_x',
        hits: [{ requestId: 'r1', endpointId: 'ep1', fieldPath: 'data.id', normalizedPath: 'data.id', type: 'get', timestamp: 1700000000000, count: 2 }],
        traces: [{ requestId: 'r1', endpointId: 'ep1', method: 'GET', url: 'http://x/api/users/u_001', path: '/users/u_001', status: 200, durationMs: 12, startedAt: '2026-09-16T00:00:00Z', endedAt: '2026-09-16T00:00:00Z' }],
        evidence: [{ fieldPath: 'data.id', evidenceType: 'text', visible: true, inViewport: true, selector: '[data-mk-field="data.id"]' }],
      })
      expect(db.prepare('SELECT count(*) AS n FROM field_hits WHERE run_id=?').get('run_x')).toEqual({ n: 1 })
      const hit = db.prepare('SELECT * FROM field_hits WHERE run_id=?').get('run_x') as Record<string, unknown>
      expect(hit.count).toBe(2)
      expect(hit.first_hit_at).toBe(new Date(1700000000000).toISOString())
      expect(db.prepare('SELECT count(*) AS n FROM request_traces WHERE run_id=?').get('run_x')).toEqual({ n: 1 })
      expect(db.prepare('SELECT count(*) AS n FROM ui_evidence WHERE run_id=?').get('run_x')).toEqual({ n: 1 })
    } finally { db.close() }
  })

  it('endRun 更新 status', () => {
    const db = openCoverageDb(dbPath)
    try {
      db.insertRun('r', '2026-09-16T00:00:00Z', 'running')
      db.endRun('r', '2026-09-16T00:01:00Z', 'completed')
      expect(db.prepare('SELECT status, ended_at FROM runs WHERE id=?').get('r')).toEqual({ status: 'completed', ended_at: '2026-09-16T00:01:00Z' })
    } finally { db.close() }
  })
})
