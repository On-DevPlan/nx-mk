import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { buildServer } from '../server/index.js'
import type { FastifyInstance } from 'fastify'
import type {
  RunsListResponse, RunDetailResponse, MetricsResponse,
  RequestsListResponse, RequestDetailResponse, FieldsListResponse, IgnoredListResponse,
} from '../shared/api-types.js'
import { makeNxMkDir, reportFixture, writeReportFile, seedDb } from './fixtures.js'

let dir: string
let app: FastifyInstance

beforeEach(() => {
  // makeNxMkDir 返回 .nx-mk 目录本身（Ruling F3）——dir 即 nxMkDir
  dir = makeNxMkDir([
    { runId: 'run_a', withEvents: true },   // 旧 run：无 db 行、无 report
    { runId: 'run_b' },                      // 最新 run：db 行 + report
  ])
  writeFileSync(join(dir, 'manifest.json'), '{}')
  seedDb(dir, {
    runs: [
      { id: 'run_b', status: 'completed', terminatedBy: 'goal-met', endedAt: '2026-09-17T10:00:05.000Z' },
      { id: 'run_a', status: 'failed' },
    ],
    traces: [
      { runId: 'run_b', traceId: 'req_1', method: 'GET', url: 'http://local/1', path: '/users/1', status: 200, durationMs: 12, startedAt: '2026-09-17T10:00:01.000Z' },
      { runId: 'run_a', traceId: 'req_old', method: 'GET', url: 'http://local/old', path: '/users/9', status: 200, durationMs: 5, startedAt: '2026-09-17T09:00:01.000Z' },
    ],
    hits: [{ runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', count: 3 }],
    evidence: [{ runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', textSample: 'Ada' }],
    coverageFields: [
      { runId: 'run_b', fieldPath: 'data.id', policyStatus: 'required', coverageState: 'covered' },
      { runId: 'run_b', fieldPath: 'data.internalRiskScore', policyStatus: 'ignored', coverageState: 'ignored' },
    ],
  })
  writeReportFile(dir, reportFixture('run_b'))
  app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui'), busyTimeoutMs: 50 })
})
afterEach(async () => {
  await app.close()
  // 清理整个 tmp 根（dir 是 .nx-mk 本身，其父才是 mkdtemp 根）——不留孤儿 tmp 目录
  rmSync(dirname(dir), { recursive: true, force: true })
})

describe('GET /api/runs', () => {
  it('newest first + db 富化 + manifestAvailable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs' })
    expect(res.statusCode).toBe(200)
    const body = res.json<RunsListResponse>()
    expect(body.manifestAvailable).toBe(true)
    expect(body.runs.map((r) => r.runId)).toEqual(['run_b', 'run_a'])
    expect(body.runs[0]).toMatchObject({ status: 'completed', terminatedBy: 'goal-met', hasReport: true, hasEvents: false })
    expect(body.runs[1]).toMatchObject({ status: 'failed', hasReport: false, hasEvents: true })
  })
  it('.nx-mk 缺失 → 空列表（spec §4）', async () => {
    const empty = buildServer({ nxMkDir: join(dir, 'no-such'), uiDistDir: join(dir, 'ui') })
    const res = await empty.inject({ method: 'GET', url: '/api/runs' })
    expect(res.json<RunsListResponse>()).toEqual({ runs: [], manifestAvailable: false })
    await empty.close()
  })
})

describe('GET /api/runs/:runId', () => {
  it('detail with dbRow', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b' })
    const body = res.json<RunDetailResponse>()
    expect(body.dbRow?.terminatedBy).toBe('goal-met')
    expect(body.hasReport).toBe(true)
  })
  it('unknown run → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_x' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/runs/:runId/metrics', () => {
  it('report 命中 → metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/metrics' })
    const body = res.json<MetricsResponse>()
    expect(body.metrics.requiredCoverage).toBe(1)
    expect(body.terminatedBy).toBe('goal-met')
  })
  it('旧 run（report runId 不匹配）→ 404 + hint', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/metrics' })
    expect(res.statusCode).toBe(404)
    expect(res.json().hint).toContain('nx-mk run')
  })
})

describe('GET /api/runs/:runId/requests', () => {
  it('report 命中 → report.requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/requests' })
    expect(res.json<RequestsListResponse>().requests[0]?.requestId).toBe('req_1')
  })
  it('无 report → request_traces 投影回落（run_a）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/requests' })
    const reqs = res.json<RequestsListResponse>().requests
    expect(reqs).toHaveLength(1)
    expect(reqs[0]).toMatchObject({ requestId: 'req_old', method: 'GET' })
  })
})

describe('GET /api/runs/:runId/requests/:requestId', () => {
  it('trace + 关联 hits/evidence', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/requests/req_1' })
    const body = res.json<RequestDetailResponse>()
    expect(body.trace.traceId).toBe('req_1')
    expect(body.hits).toHaveLength(1)
    expect(body.evidence[0]?.textSample).toBe('Ada')
  })
  it('unknown requestId → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/requests/req_99' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/runs/:runId/fields', () => {
  it('db 行 + report 富化（hitCount/matchedRule）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/fields' })
    const fields = res.json<FieldsListResponse>().fields
    expect(fields).toHaveLength(2)
    const ignored = fields.find((f) => f.fieldPath === 'data.internalRiskScore')
    expect(ignored?.hitCount).toBe(1)
    expect(ignored?.matchedRule?.pattern).toBe('data.internalRiskScore')
    const covered = fields.find((f) => f.fieldPath === 'data.id')
    expect(covered?.hitCount).toBeUndefined()
  })
  it('db 缺失 → {fields:[]}（spec §4）', async () => {
    // 用一个没有 coverage.db 的 .nx-mk（dir2 即 .nx-mk 本身，Ruling F3）
    const dir2 = makeNxMkDir([{ runId: 'run_c' }])
    const app2 = buildServer({ nxMkDir: dir2, uiDistDir: join(dir, 'ui') })
    const res = await app2.inject({ method: 'GET', url: '/api/runs/run_c/fields' })
    expect(res.json<FieldsListResponse>()).toEqual({ fields: [] })
    await app2.close()
    rmSync(dirname(dir2), { recursive: true, force: true })
  })
})

describe('GET /api/runs/:runId/ignored', () => {
  it('report 命中 → ignored 列表', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/ignored' })
    const body = res.json<IgnoredListResponse>()
    expect(body.ignored).toHaveLength(1)
    expect(body.ignored[0]?.fieldPath).toBe('data.internalRiskScore')
  })
  it('旧 run → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/ignored' })
    expect(res.statusCode).toBe(404)
  })
})

describe('busy → 503', () => {
  it('写锁持有期间查询 → 503 + hint', async () => {
    const writer = new Database(join(dir, 'coverage.db'))
    // WAL 下读者永不阻塞，切 DELETE 模式才能确定性复现读阻塞
    writer.pragma('journal_mode = DELETE')
    writer.exec('BEGIN EXCLUSIVE')
    try {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/fields' })
      expect(res.statusCode).toBe(503)
      expect(res.json().hint).toContain('run in progress')
    } finally {
      writer.exec('ROLLBACK')
      writer.close()
    }
  })
})
