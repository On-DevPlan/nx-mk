/**
 * Phase 4 集成（hermetic，spec §6）：真 SQLite fixture + 真 report.json →
 * buildServer 后 7 条路由端到端 inject 契约抽查。
 * 真实链路（nx-mk start + 浏览器）= demo 手动验收（README 步骤）。
 */
import { it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { buildServer } from '../../packages/dashboard/src/server/index.js'
import { makeNxMkDir, reportFixture, writeReportFile, seedDb } from '../../packages/dashboard/src/__tests__/fixtures.js'

let dir: string

beforeEach(() => {
  // makeNxMkDir 返回 .nx-mk 目录本身（Ruling F3）——dir 即 nxMkDir
  dir = makeNxMkDir([{ runId: 'run_b', withEvents: true }])
  seedDb(dir, {
    runs: [{ id: 'run_b', status: 'completed', terminatedBy: 'goal-met' }],
    traces: [{ runId: 'run_b', traceId: 'req_1', method: 'GET', url: 'http://local/1', path: '/users/1', status: 200 }],
    hits: [{ runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name' }],
    evidence: [{ runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', textSample: 'Ada', visible: true }],
    coverageFields: [{ runId: 'run_b', fieldPath: 'data.name', policyStatus: 'required', coverageState: 'covered' }],
  })
  writeReportFile(dir, reportFixture('run_b'))
})
// 清理整个 tmp 根（dir 是 .nx-mk 本身，其父才是 mkdtemp 根）——不留孤儿 tmp 目录
afterEach(() => rmSync(dirname(dir), { recursive: true, force: true }))

function makeApp() {
  return buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
}

it('三点审计链互证：runs 行 + report 指标 + events 存在性', async () => {
  const app = makeApp()
  const runs = (await app.inject({ method: 'GET', url: '/api/runs' })).json()
  expect(runs.runs[0]).toMatchObject({ runId: 'run_b', hasEvents: true, hasReport: true, terminatedBy: 'goal-met' })
  const metrics = (await app.inject({ method: 'GET', url: '/api/runs/run_b/metrics' })).json()
  expect(metrics.metrics.requiredCoverage).toBe(1)
  await app.close()
})

it('requests → detail 全链（trace/hits/evidence 关联）', async () => {
  const app = makeApp()
  const list = (await app.inject({ method: 'GET', url: '/api/runs/run_b/requests' })).json()
  expect(list.requests[0].requestId).toBe('req_1')
  const detail = (await app.inject({ method: 'GET', url: '/api/runs/run_b/requests/req_1' })).json()
  expect(detail.trace.method).toBe('GET')
  expect(detail.hits).toHaveLength(1)
  expect(detail.evidence[0].textSample).toBe('Ada')
  await app.close()
})

it('fields + ignored 契约', async () => {
  const app = makeApp()
  const fields = (await app.inject({ method: 'GET', url: '/api/runs/run_b/fields' })).json()
  expect(fields.fields[0].fieldPath).toBe('data.name')
  const ignored = (await app.inject({ method: 'GET', url: '/api/runs/run_b/ignored' })).json()
  expect(ignored.ignored[0].fieldPath).toBe('data.internalRiskScore')
  await app.close()
})
