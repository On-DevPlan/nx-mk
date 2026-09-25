/**
 * analyzer 全量（spec §3.3）：四态 + 三指标 + ignored-returned + suspicious + 列值锁。
 * fixture：manifest 5 response 字段（2 required 命中/未命中 / 1 optional 命中 / 1 ignored 命中）+
 * evidence（1 valid / 1 weak / 1 suspicious）—— 沿既有 tmp SQLite + insertRun arrange。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '../src/index.js'
import { evaluatePolicy, type PolicyDecision } from '../src/policy/index.js'
import { analyzeCoverage, type AnalyzeDrained, type CoverageReport } from '../src/analyzer/index.js'
import type { ApiManifest } from '@nx-mk/manifest-schema'

// fixture 字段（normalizedPath 即 §17 形态）：
//   data.name (required) 命中 | data.email (required) 未命中 | data.tags[] (optional) 命中
//   data.internalRiskScore (ignored) 命中 | data.address.city (optional) 未命中
const FIELDS = [
  { id: 'h1', normalizedPath: 'data.name', required: true, endpointId: 'getUser', direction: 'response' as const },
  { id: 'h2', normalizedPath: 'data.email', required: true, endpointId: 'getUser', direction: 'response' as const },
  { id: 'h3', normalizedPath: 'data.tags[]', required: false, endpointId: 'getUser', direction: 'response' as const },
  { id: 'h4', normalizedPath: 'data.internalRiskScore', required: false, endpointId: 'getUser', direction: 'response' as const },
  { id: 'h5', normalizedPath: 'data.address.city', required: false, endpointId: 'getUser', direction: 'response' as const },
]
const POLICY = { required: [], optional: [], ignored: ['data.internalRiskScore'] }
const DECISIONS = evaluatePolicy(FIELDS, POLICY)
const HITS = (paths: string[]): AnalyzeDrained['hits'] =>
  paths.map((normalizedPath) => ({ normalizedPath, count: 1, requestId: 'r1', endpointId: 'getUser' }))
const TRACE_GET_USER = { endpointId: 'getUser', method: 'GET', path: '/users/{id}' }

const MANIFEST: ApiManifest = {
  version: '1',
  source: { type: 'openapi', input: 'x.json', hash: 'h' },
  generatedAt: '',
  schemas: {},
  fields: FIELDS.map((f) => ({
    id: f.id,
    endpointId: f.endpointId,
    direction: 'response' as const,
    status: '200',
    path: f.normalizedPath.replace('[]', '[0]'),
    normalizedPath: f.normalizedPath,
    name: f.normalizedPath.split('.').pop() ?? '',
    type: 'string',
    ...(f.required ? { required: true } : {}),
    source: { openapiPointer: '' },
  })),
  endpoints: [{ id: 'getUser', method: 'GET', path: '/users/{id}', responses: [{ status: '200', fields: [] }] }],
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-an-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

/** arrange + act：tmp db + insertRun + 新签名调用（traces/evidence 缺省为空） */
function analyzeWith(
  drained: Partial<AnalyzeDrained> & { hits: AnalyzeDrained['hits'] },
  manifest: ApiManifest = MANIFEST,
  policyDecisions: PolicyDecision[] = DECISIONS,
): CoverageReport {
  const db = openCoverageDb(join(dir, 'c.db'))
  try {
    db.insertRun('run1', new Date().toISOString(), 'running')
    return analyzeCoverage({
      runId: 'run1',
      manifest,
      policyDecisions,
      drained: { traces: [], evidence: [], ...drained },
      db,
    })
  } finally { db.close() }
}

/** 读回 coverage_fields 单行（列值锁用） */
function fieldRow(fieldId: string): Record<string, unknown> {
  const db = openCoverageDb(join(dir, 'c.db'))
  try {
    return db.prepare('SELECT * FROM coverage_fields WHERE field_id = ?').get(fieldId) as Record<string, unknown>
  } finally { db.close() }
}

describe('analyzeCoverage — 四态与三指标', () => {
  it('covered：required/optional 且 accessHit', () => {
    const r = analyzeWith({ hits: HITS(['data.name', 'data.tags[]']) })
    expect(r.missingRequiredFields.map((f) => f.fieldPath)).toEqual(['data.email'])
    expect(fieldRow('h1')).toMatchObject({ coverage_state: 'covered' })
  })

  it('uiHit 计入 covered；suspicious evidence 不计入且进 suspiciousCoverage；weak 计入且进 weakEvidenceFields', () => {
    const r = analyzeWith({
      hits: HITS(['data.address.city']),
      evidence: [
        { fieldPath: 'data.name', visible: true, textSample: 'Alice' },
        { fieldPath: 'data.email', visible: true, textSample: '' },
        { fieldPath: 'data.tags[]', visible: false, textSample: 'secret' },
      ],
    })
    // data.name：无 access hit 但 evidence valid → uiHit → covered
    expect(fieldRow('h1')).toMatchObject({ coverage_state: 'covered', access_hit: 0, ui_hit: 1 })
    // data.email：weak 计 hit → covered 且进 weak 清单
    expect(fieldRow('h2')).toMatchObject({ coverage_state: 'covered', ui_hit: 1 })
    expect(r.weakEvidenceFields.map((f) => f.fieldPath)).toEqual(['data.email'])
    // data.tags[]：suspicious 不算 hit → notApplicable + 进 suspiciousCoverage + suspicious 列置 1
    expect(fieldRow('h3')).toMatchObject({ coverage_state: 'notApplicable', ui_hit: 0, suspicious: 1 })
    expect(r.suspiciousCoverage.map((f) => f.fieldPath)).toEqual(['data.tags[]'])
    // data.address.city：本用例唯一 access 命中 → covered
    expect(fieldRow('h5')).toMatchObject({ coverage_state: 'covered', access_hit: 1 })
  })

  it('ignored 命中 → ignored-returned 集合（§22 数据）', () => {
    const r = analyzeWith({ hits: HITS(['data.name', 'data.internalRiskScore']) })
    expect(r.ignoredReturnedFields).toEqual([
      expect.objectContaining({
        fieldPath: 'data.internalRiskScore',
        state: 'ignored',
        hitCount: 1,
        matchedRule: { source: 'user-config', pattern: 'data.internalRiskScore' },
      }),
    ])
    expect(fieldRow('h4')).toMatchObject({ policy_status: 'ignored', coverage_state: 'ignored', access_hit: 1 })
  })

  it('C2：matchedRule.reason 落 matched_rule_reason 列（对象条目 → 决策 → 落库透出）', () => {
    const decisions = evaluatePolicy(FIELDS, {
      ignored: [{ pattern: 'data.internalRiskScore', reason: '内部风控字段，不应展示' }],
    })
    const r = analyzeWith({ hits: HITS(['data.internalRiskScore']) }, MANIFEST, decisions)
    expect(r.ignoredReturnedFields[0]?.matchedRule?.reason).toBe('内部风控字段，不应展示')
    expect(fieldRow('h4')).toMatchObject({ matched_rule_reason: '内部风控字段，不应展示' })
    // 默认规则（无用户匹配）的 reason 也随决策落列
    expect(fieldRow('h1')).toMatchObject({ matched_rule_reason: 'OpenAPI required 标记' })
  })

  it('三指标算术（§21.6）与零分母', () => {
    const r = analyzeWith({ hits: HITS(['data.name', 'data.tags[]', 'data.internalRiskScore', 'data.address.city']) })
    expect(r.metrics.requiredCoverage).toBeCloseTo(1 / 2)        // name 命中 / email 未命中
    expect(r.metrics.effectiveCoverage).toBeCloseTo(3 / 4)       // 分母 required2+optional2；covered: name/tags[]/city
    expect(r.metrics.rawBackendFieldCoverage).toBeCloseTo(4 / 5) // returned 4 / response 5
    // 空分母：无 required 字段 → 0（不 NaN）
    const noReqFields = FIELDS.filter((f) => f.required !== true)
    const m: ApiManifest = { ...MANIFEST, fields: MANIFEST.fields.filter((f) => !f.required) }
    const r2 = analyzeWith({ hits: [] }, m, evaluatePolicy(noReqFields, POLICY))
    expect(r2.metrics.requiredCoverage).toBe(0)
    expect(r2.metrics.effectiveCoverage).toBe(0)
    expect(r2.metrics.rawBackendFieldCoverage).toBe(0)
  })

  it('metrics 计数与 §28.2 形状（endpoints/counts）', () => {
    const r = analyzeWith({
      hits: HITS(['data.name', 'data.tags[]', 'data.internalRiskScore', 'data.address.city']),
      traces: [TRACE_GET_USER],
    })
    expect(r.runId).toBe('run1')
    expect(r.metrics).toMatchObject({
      endpointsTotal: 1,
      endpointsCalled: 1,
      fieldsTotal: 5,
      fieldsReturned: 4,
      requiredFields: 2,
      missingRequiredFields: 1,
      ignoredReturnedFields: 1,
      suspiciousFields: 0,
    })
    expect(r.endpoints).toEqual([
      { endpointId: 'getUser', method: 'GET', path: '/users/{id}', called: true, fieldsTotal: 5, fieldsCovered: 3 },
    ])
  })

  it('coverage_fields 列值锁（13 列逐列绑定，state 迁移 D6）', () => {
    analyzeWith({ hits: HITS(['data.name', 'data.internalRiskScore']) })
    // data.name（schema required → default required；命中 → covered）
    expect(fieldRow('h1')).toMatchObject({
      id: 'cf_run1_data.name',
      run_id: 'run1',
      field_id: 'h1',
      endpoint_id: 'getUser',
      field_path: 'data.name',
      policy_status: 'required',
      coverage_state: 'covered',
      access_hit: 1,
      ui_hit: 0,
      assertion_hit: 0,
      suspicious: 0,
      counted_required: 1,
      counted_effective: 1,
    })
    // data.email（required 未命中 → missing）
    expect(fieldRow('h2')).toMatchObject({ coverage_state: 'missing', counted_required: 1, counted_effective: 1 })
    // data.tags[]（optional 未命中 → notApplicable，取代旧 'optional-unhit'）
    expect(fieldRow('h3')).toMatchObject({ coverage_state: 'notApplicable', counted_required: 0, counted_effective: 1 })
    // data.internalRiskScore（user-config ignored → counted_*=0）
    expect(fieldRow('h4')).toMatchObject({ policy_status: 'ignored', coverage_state: 'ignored', counted_required: 0, counted_effective: 0 })
  })
})

describe('analyzeCoverage — requests 摘要（§28.2 契约完整性）', () => {
  it('traces → requests 逐请求投影；缺失的可选字段不臆造', () => {
    const r = analyzeWith({
      hits: HITS(['data.name']),
      traces: [
        // 全字段 trace（RequestTraceCore 形状）
        {
          requestId: 'r1', endpointId: 'getUser', method: 'GET', url: 'http://x/users/1',
          path: '/users/{id}', status: 200, durationMs: 5, startedAt: 't0', endedAt: 't1',
        },
        // 最小 trace（缺 requestId/url 等）→ 缺省字段保持缺省
        { endpointId: 'getUser', method: 'POST' },
      ],
    })
    expect(r.requests).toEqual([
      {
        requestId: 'r1', endpointId: 'getUser', method: 'GET', url: 'http://x/users/1',
        path: '/users/{id}', status: 200, durationMs: 5, startedAt: 't0', endedAt: 't1',
      },
      { endpointId: 'getUser', method: 'POST' },
    ])
  })

  it('空 traces → requests 空数组', () => {
    const r = analyzeWith({ hits: HITS(['data.name']), traces: [] })
    expect(r.requests).toEqual([])
  })
})

describe('analyzeCoverage — B1 写入原子性（hygiene）', () => {
  it('mid-loop insert failure rolls back all coverage_fields rows (transaction path)', () => {
    // 真实 CoverageDb（better-sqlite3）→ 有 transaction → 走单事务批量落库
    const db = openCoverageDb(join(dir, 'b1.db'))
    try {
      db.insertRun('run_b1', new Date().toISOString(), 'running')
      // 干扰行：插入函数在第 3 行时抛错，验证前 2 行也一起回滚
      let calls = 0
      const realPrepare = db.prepare.bind(db)
      const insSpy = (sql: string) => {
        const real = realPrepare(sql)
        if (sql.includes('INSERT OR REPLACE INTO coverage_fields')) {
          return {
            run: (...params: unknown[]): unknown => {
              calls += 1
              if (calls === 3) throw new Error('simulated mid-loop failure')
              return real.run(...params)
            },
            get: real.get.bind(real),
          }
        }
        return real
      }
      ;(db as unknown as { prepare: typeof insSpy }).prepare = insSpy
      expect(() =>
        analyzeCoverage({
          runId: 'run_b1', manifest: MANIFEST, policyDecisions: DECISIONS,
          drained: { traces: [], evidence: [], hits: HITS(['data.name']) },
          db,
        }),
      ).toThrow('simulated mid-loop failure')
      ;(db as unknown as { prepare: typeof realPrepare }).prepare = realPrepare
      // 回滚验证：任意行都没落库
      const n = db.prepare('SELECT COUNT(*) AS n FROM coverage_fields WHERE run_id = ?').get('run_b1') as { n: number }
      expect(n.n).toBe(0)
    } finally { db.close() }
  })

  it('transaction-capable db: analyzer uses the transaction branch (wrapped=true, all rows written)', () => {
    // 兼容性锁：带 transaction 的替身走批量路径，写结果正确
    const db = openCoverageDb(join(dir, 'b1b.db'))
    try {
      let wrapped = false
      const proxy = {
        prepare: db.prepare.bind(db),
        // better-sqlite3 形状：transaction(fn) 返回包装可调用，再调用一次执行
        transaction: (fn: () => void): (() => void) => () => {
          wrapped = true
          fn()
        },
      }
      db.insertRun('run_b1b', new Date().toISOString(), 'running')
      analyzeCoverage({
        runId: 'run_b1b', manifest: MANIFEST, policyDecisions: DECISIONS,
        drained: { traces: [], evidence: [], hits: HITS(['data.name']) },
        db: proxy as unknown as Parameters<typeof analyzeCoverage>[0]['db'],
      })
      expect(wrapped).toBe(true)
      const n = db.prepare('SELECT COUNT(*) AS n FROM coverage_fields WHERE run_id = ?').get('run_b1b') as { n: number }
      expect(n.n).toBe(5) // MANIFEST 5 response fields, all inserted
    } finally { db.close() }
  })

  it('db without transaction capability degrades to row-by-row (behavior unchanged)', () => {
    // 真 fallback 锁：db 完全没有 transaction 属性 → 逐条路径仍写全所有行
    const db = openCoverageDb(join(dir, 'b1c.db'))
    try {
      const proxy = { prepare: db.prepare.bind(db) } // 无 transaction 属性
      db.insertRun('run_b1c', new Date().toISOString(), 'running')
      analyzeCoverage({
        runId: 'run_b1c', manifest: MANIFEST, policyDecisions: DECISIONS,
        drained: { traces: [], evidence: [], hits: HITS(['data.name']) },
        db: proxy as unknown as Parameters<typeof analyzeCoverage>[0]['db'],
      })
      const n = db.prepare('SELECT COUNT(*) AS n FROM coverage_fields WHERE run_id = ?').get('run_b1c') as { n: number }
      expect(n.n).toBe(5)
    } finally { db.close() }
  })
})

describe('analyzeCoverage — unknown 分支（hygiene-B2）', () => {
  it('decision 缺失 → policy_status=unknown，state=notApplicable，不进两分母（spec §3.3）', () => {
    // 构造 decision 全缺（evaluatePolicy 对空输入返回空数组）：analyzer 走 `?? 'unknown'`
    // 分支 —— v0 锁定：不抛错、不计 counted_*，policy_status 落 unknown 列
    const r = analyzeWith({ hits: HITS(['data.name']) }, MANIFEST, [])
    // unknown + access 命中 → state=covered（判定序：ignored → hit → …）
    expect(fieldRow('h1')).toMatchObject({ policy_status: 'unknown', coverage_state: 'covered', access_hit: 1 })
    // unknown + 未命中 → state=notApplicable（h5 data.address.city 无 hit）
    expect(fieldRow('h5')).toMatchObject({
      policy_status: 'unknown',
      coverage_state: 'notApplicable',
      access_hit: 0,
      counted_required: 0,
      counted_effective: 0,
    })
    // 分母不进：metrics 字段数照计（fieldsTotal 来自 manifest），required/effective 分母全 0
    expect(r.metrics).toMatchObject({ requiredFields: 0, requiredCoverage: 0, effectiveCoverage: 0 })
  })
})
