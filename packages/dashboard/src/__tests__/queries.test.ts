import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { openReader } from '../server/store/db-reader.js'
import type { CoverageDbReader } from '../server/store/db-reader.js'
import { Queries } from '../server/store/queries.js'
import { makeNxMkDir, seedDb } from './fixtures.js'

let dir: string
// Windows：未关闭的 sqlite 句柄会令 rmSync unlink 报 EBUSY——afterEach 先关再删
let openReaders: CoverageDbReader[] = []
beforeEach(() => {
  dir = makeNxMkDir([])
  seedDb(dir, {
    runs: [
      { id: 'run_a', status: 'failed', startedAt: '2026-09-17T09:00:00.000Z' },
      { id: 'run_b', status: 'completed', terminatedBy: 'goal-met', startedAt: '2026-09-17T10:00:00.000Z', endedAt: '2026-09-17T10:00:05.000Z' },
    ],
    traces: [
      { runId: 'run_b', traceId: 'req_1', method: 'GET', url: 'http://local/1', path: '/users/1', status: 200, durationMs: 12, startedAt: '2026-09-17T10:00:01.000Z' },
      { runId: 'run_b', traceId: 'req_2', method: 'POST', url: 'http://local/2', path: '/users', status: 201, durationMs: 30, startedAt: '2026-09-17T10:00:02.000Z' },
    ],
    hits: [
      { runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', count: 3 },
      { runId: 'run_b', requestId: null, fieldPath: 'data.email', count: 1 },
    ],
    evidence: [
      { runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', textSample: 'Ada' },
      { runId: 'run_b', requestId: null, fieldPath: 'data.email', textSample: null },
    ],
    coverageFields: [
      { runId: 'run_b', fieldPath: 'data.id', policyStatus: 'required', coverageState: 'covered', accessHit: 1, uiHit: 1 },
      { runId: 'run_b', fieldPath: 'data.internalRiskScore', policyStatus: 'ignored', coverageState: 'ignored', accessHit: 1, uiHit: 0 },
    ],
  })
})
// 清理整个 tmp 根（makeNxMkDir 的 mkdtemp 根，.nx-mk 是其子目录）——不留孤儿 tmp 目录
afterEach(() => {
  for (const r of openReaders) r.close()
  openReaders = []
  rmSync(dirname(dir), { recursive: true, force: true })
})

function q(): Queries {
  const reader = openReader(join(dir, 'coverage.db'))
  expect(reader).not.toBeNull()
  openReaders.push(reader!)
  return new Queries(reader!)
}

describe('Queries', () => {
  it('getRun found → RunRow camelCase + terminatedBy', () => {
    const row = q().getRun('run_b')
    expect(row).toMatchObject({
      id: 'run_b', status: 'completed', terminatedBy: 'goal-met',
      startedAt: '2026-09-17T10:00:00.000Z', endedAt: '2026-09-17T10:00:05.000Z',
      projectName: null, manifestHash: null,
    })
  })
  it('getRun unknown → undefined', () => {
    expect(q().getRun('run_x')).toBeUndefined()
  })
  it('listRuns ordered by started_at asc', () => {
    expect(q().listRuns().map((r) => r.id)).toEqual(['run_a', 'run_b'])
  })
  it('listTraces projects §25.4 columns', () => {
    const traces = q().listTraces('run_b')
    expect(traces).toHaveLength(2)
    expect(traces[0]).toMatchObject({ traceId: 'req_1', method: 'GET', status: 200, durationMs: 12, scenarioId: null })
  })
  it('getTrace by trace_id', () => {
    expect(q().getTrace('run_b', 'req_2')?.method).toBe('POST')
    expect(q().getTrace('run_b', 'req_9')).toBeUndefined()
  })
  it('listHitsByRequest filters by request_id (unlinked excluded)', () => {
    const hits = q().listHitsByRequest('run_b', 'req_1')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ fieldPath: 'data.name', count: 3, requestId: 'req_1' })
  })
  it('listEvidenceByRequest + textSample 投影', () => {
    const ev = q().listEvidenceByRequest('run_b', 'req_1')
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ fieldPath: 'data.name', textSample: 'Ada', visible: 1 })
  })
  it('listCoverageFields 13 列投影', () => {
    const fields = q().listCoverageFields('run_b')
    expect(fields).toHaveLength(2)
    expect(fields[0]).toMatchObject({
      fieldPath: 'data.id', policyStatus: 'required', coverageState: 'covered',
      accessHit: 1, uiHit: 1, assertionHit: 0, suspicious: 0,
      countedRequired: 1, countedEffective: 1,
    })
  })
  it('run 隔离：run_a 查不到 run_b 的行', () => {
    expect(q().listTraces('run_a')).toEqual([])
    expect(q().listCoverageFields('run_a')).toEqual([])
  })
})
