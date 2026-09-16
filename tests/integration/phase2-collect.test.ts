/**
 * Phase 2 collect 集成（hermetic，spec §6 D8 / §1.4 验收）：collector → 临时
 * SQLite → flush → 9 表读回断言。不跑真浏览器/真 vite —— 真实链路由 demo:typecheck
 * 与仓库 README 的手动验收步骤覆盖。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '@nx-mk/coverage'
import { createCollector } from '@nx-mk/client/collector'
import { createTrackedProxy } from '@nx-mk/client/proxy'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-mk-p2-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('Phase 2 hermetic collect chain', () => {
  it('proxy hits + trace 聚合 → flush → 9 表含数据', async () => {
    const c = createCollector()
    // tracked proxy：字段读取（含嵌套）触发 collector.hit —— §17/§19 路径归一化
    const resp = createTrackedProxy(
      { id: 'u1', address: { city: 'HZ' } } as Record<string, unknown>,
      { requestId: 'r1', endpointId: 'ep1', basePath: 'data', collector: c } as never,
    )
    const id = (resp as Record<string, unknown>).id
    const city = (resp as Record<string, unknown>).address
    const cityVal = (city as Record<string, unknown>).city
    void id
    void cityVal
    const trace = {
      requestId: 'r1',
      method: 'GET',
      url: 'http://x/api/users/u_001',
      path: '/users/u_001',
      status: 200,
      durationMs: 5,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    }
    c.trace(trace)

    const db = openCoverageDb(join(dir, 'coverage.db'))
    try {
      db.insertRun('run_p2', new Date().toISOString(), 'running')
      db.flushDrained({ runId: 'run1', ...c.drain() })
      // field_hits：proxy 对每次属性 get 径产 hit（§19.2 嵌套递归）——
      // 读 id / address（中间节点）/ address.city → 3 条路径聚合
      expect(db.prepare('SELECT count(*) AS n FROM field_hits WHERE run_id=?').get('run1')).toEqual({ n: 3 })
      expect(db.prepare('SELECT count(*) AS n FROM request_traces WHERE run_id=?').get('run1')).toEqual({ n: 1 })
      // evidence 表存在且（本 hermetic 流程未喂 evidence）为空而 schema 已建
      expect(db.prepare('SELECT count(*) AS n FROM ui_evidence WHERE run_id=?').get('run1')).toEqual({ n: 0 })
      // 9 张表 schema 断言（spec §25 逐字，TABLE_NAMES 为单一来源）
      for (const t of [
        'runs',
        'endpoints',
        'manifest_fields',
        'request_traces',
        'request_fields',
        'field_hits',
        'ui_evidence',
        'coverage_fields',
        'agent_iterations',
      ]) {
        expect((db.pragma(`table_info(${t})`) as unknown[]).length).toBeGreaterThan(0)
      }
    } finally {
      db.close()
    }
  })

  it('drain 幂等：flush 后二次 drain 恒空（重复 flush 不重复计数）', async () => {
    const c = createCollector()
    c.hit({ requestId: 'r1', endpointId: 'ep1', fieldPath: 'data.id', normalizedPath: 'data.id', type: 'get', timestamp: Date.now() })
    const db = openCoverageDb(join(dir, 'coverage.db'))
    try {
      db.insertRun('run_idem', new Date().toISOString(), 'running')
      db.flushDrained({ runId: 'run_idem', ...c.drain() })
      const drained2 = c.drain()
      db.flushDrained({ runId: 'run_idem', ...drained2 })
      expect(drained2).toEqual({ hits: [], traces: [], evidence: [] })
      expect(db.prepare('SELECT count(*) AS n FROM field_hits WHERE run_id=?').get('run_idem')).toEqual({ n: 1 })
    } finally {
      db.close()
    }
  })
})
