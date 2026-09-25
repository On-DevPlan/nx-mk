/**
 * Coverage Analyzer 全量（plan §28 / spec §3.3）。纯函数核心 + coverage_fields IO。
 * 输入：manifest + policy 决策 + collector drain 产物；输出 §28.2 CoverageReport。
 * 四态 §21.3：ignored → 'ignored'；(accessHit ∨ uiHit) → 'covered'；required 未命中 → 'missing'；
 * optional/unknown 未命中 → 'notApplicable'（D6：state 枚举自 D7 'optional-unhit' 迁移）。
 * uiHit 语义：该字段存在 evidence 且 classifyEvidence !== 'suspicious'（weak 计 hit 但入 weak 清单）。
 */
import type { ApiManifest } from '@nx-mk/manifest-schema'
import { classifyEvidence } from '../anti-cheat/index.js'
import type { EvidenceQuality } from '../anti-cheat/index.js'
import type { PolicyDecision } from '../policy/index.js'
import type { CoverageReport, FieldCoverageItem, EndpointCoverage, RequestTraceSummary } from './report.js'

export interface AnalyzerDb {
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
  }
  /**
   * B1（hygiene）：批量写事务 —— 真实 CoverageDb（better-sqlite3 db 底座）提供；
   * 任一行失败则全部回滚。可选以保持测试替身兼容（无 transaction 时逐条执行，行为同前）。
   * 形状对齐 better-sqlite3：transaction(fn) 返回包装后的可调用，需要再调用一次执行。
   * 类型精度（4.5 备忘 B1-minor）：用属性函数类型而非方法语法 —— 严格变型检查，
   * 与 CoverageDb 的结构化赋值判定一致。
   */
  transaction?: (fn: () => void) => () => void
}

export interface AnalyzeDrained {
  hits: { normalizedPath: string; count: number }[]
  /** traces 输入即 §28.2 摘要形状（client RequestTraceCore 结构兼容；多余字段投影时丢弃） */
  traces: RequestTraceSummary[]
  evidence: { fieldPath: string; visible?: boolean; textSample?: string }[]
}

export interface AnalyzeInput {
  runId: string
  manifest: ApiManifest
  policyDecisions: PolicyDecision[]
  drained: AnalyzeDrained
  db: AnalyzerDb
}

// 质量排序（取最差）：invalid > suspicious > weak > valid
const QUALITY_RANK: Record<EvidenceQuality, number> = { valid: 0, weak: 1, suspicious: 2, invalid: 3 }

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export function analyzeCoverage(input: AnalyzeInput): CoverageReport {
  const { runId, manifest, policyDecisions, drained, db } = input

  // 1. 索引：hitCount by normalizedPath（count>0）；evidence by fieldPath（同字段多条取最差质量）；
  //    decision by fieldPath
  const hitCount = new Map<string, number>()
  for (const h of drained.hits) {
    if (h.count > 0) hitCount.set(h.normalizedPath, (hitCount.get(h.normalizedPath) ?? 0) + h.count)
  }
  const worstQuality = new Map<string, EvidenceQuality>()
  for (const ev of drained.evidence) {
    const q = classifyEvidence(ev)
    const prev = worstQuality.get(ev.fieldPath)
    if (prev === undefined || QUALITY_RANK[q] > QUALITY_RANK[prev]) worstQuality.set(ev.fieldPath, q)
  }
  const decisionByPath = new Map<string, PolicyDecision>()
  for (const d of policyDecisions) decisionByPath.set(d.fieldPath, d)

  const missingRequiredFields: FieldCoverageItem[] = []
  const weakEvidenceFields: FieldCoverageItem[] = []
  const ignoredReturnedFields: FieldCoverageItem[] = []
  const suspiciousCoverage: FieldCoverageItem[] = []
  const epTally = new Map<string, { total: number; covered: number }>()

  let fieldsTotal = 0
  let fieldsReturned = 0
  let requiredFields = 0
  let requiredCovered = 0
  let effectiveTotal = 0
  let effectiveCovered = 0

  const ins = db.prepare(
    `INSERT OR REPLACE INTO coverage_fields
       (id, run_id, field_id, endpoint_id, field_path, policy_status, coverage_state, access_hit, ui_hit, assertion_hit, suspicious, counted_required, counted_effective, matched_rule_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  // B1（hygiene）：先收集全部行参数（纯分析），循环结束后单事务批量落库 ——
  // 中途任意一行失败 → 全部回滚，避免失败 run 残留部分 coverage_fields
  const rows: unknown[][] = []

  // 2-3. 遍历 manifest.fields（direction==='response'）：查 decision（缺 → 'unknown'、两分母不进）；
  //      state 判定 + 四组清单组装 + metrics 累计（分母为零 → 0，不 NaN）
  for (const f of manifest.fields) {
    if (f.direction !== 'response') continue
    const decision = decisionByPath.get(f.normalizedPath)
    const policyStatus = decision?.status ?? 'unknown'
    const countedRequired = decision?.countedInRequiredCoverage === true
    const countedEffective = decision?.countedInEffectiveCoverage === true

    const accessHit = hitCount.has(f.normalizedPath)
    const quality = worstQuality.get(f.normalizedPath)
    // uiHit：evidence 存在且非 suspicious/invalid（weak 计 hit）；suspicious 不算 hit 但进清单
    const uiHit = quality !== undefined && quality !== 'suspicious' && quality !== 'invalid'
    const suspicious = quality === 'suspicious' || quality === 'invalid'

    const hit = accessHit || uiHit
    let state: FieldCoverageItem['state']
    if (policyStatus === 'ignored') state = 'ignored'
    else if (hit) state = 'covered'
    else if (policyStatus === 'required') state = 'missing'
    else state = 'notApplicable'

    const item: FieldCoverageItem = {
      fieldId: f.id,
      fieldPath: f.normalizedPath,
      endpointId: f.endpointId,
      state,
      policyStatus,
      ...(accessHit ? { hitCount: hitCount.get(f.normalizedPath) } : {}),
      ...(decision?.matchedRule ? { matchedRule: { ...decision.matchedRule } } : {}),
    }

    fieldsTotal += 1
    if (hit) fieldsReturned += 1
    if (countedRequired) {
      requiredFields += 1
      if (state === 'covered') requiredCovered += 1
    }
    if (countedEffective) {
      effectiveTotal += 1
      if (state === 'covered') effectiveCovered += 1
    }
    const tally = epTally.get(f.endpointId) ?? { total: 0, covered: 0 }
    tally.total += 1
    if (state === 'covered') tally.covered += 1
    epTally.set(f.endpointId, tally)

    if (state === 'missing') missingRequiredFields.push(item)
    if (quality === 'weak') weakEvidenceFields.push(item)
    if (suspicious) suspiciousCoverage.push(item)
    if (policyStatus === 'ignored' && hit) ignoredReturnedFields.push(item)

    // 5. coverage_fields 14 列逐列绑定（id `cf_${runId}_${normalizedPath}`；assertion_hit 恒 0；
    //    matched_rule_reason C2 —— 用户配置 reason 透出，默认规则的 reason 也随决策落列）
    rows.push([
      `cf_${runId}_${f.normalizedPath}`, runId, f.id, f.endpointId, f.normalizedPath,
      policyStatus, state, accessHit ? 1 : 0, uiHit ? 1 : 0, 0, suspicious ? 1 : 0,
      countedRequired ? 1 : 0, countedEffective ? 1 : 0,
      decision?.matchedRule?.reason ?? null,
    ])
  }

  // B1：单事务批量落库（有 transaction 能力时——形状对齐 better-sqlite3：
  // transaction(fn) 返回包装可调用，需再调用一次执行；任一行失败全回滚）；否则逐条（测试替身兼容）
  if (db.transaction) {
    const tx = db.transaction(() => {
      for (const r of rows) ins.run(...r)
    })
    tx()
  } else {
    for (const r of rows) ins.run(...r)
  }

  // 4. endpoints：manifest.endpoints × traces endpointId 去重（'unknown'/空 不计 called）
  const calledSet = new Set<string>()
  for (const t of drained.traces) {
    if (t.endpointId && t.endpointId !== 'unknown') calledSet.add(t.endpointId)
  }
  const endpoints: EndpointCoverage[] = manifest.endpoints.map((e) => {
    const tally = epTally.get(e.id) ?? { total: 0, covered: 0 }
    return {
      endpointId: e.id,
      method: e.method,
      path: e.path,
      called: calledSet.has(e.id),
      fieldsTotal: tally.total,
      fieldsCovered: tally.covered,
    }
  })
  const endpointsCalled = endpoints.filter((e) => e.called).length

  // requests 摘要（§28.2 契约完整性）：drained.traces 逐请求投影 —— 已知键逐一选取，
  // 输入缺失的可选字段保持 undefined（不臆造）
  const requests: RequestTraceSummary[] = drained.traces.map((t) => ({
    requestId: t.requestId,
    endpointId: t.endpointId,
    method: t.method,
    url: t.url,
    path: t.path,
    status: t.status,
    durationMs: t.durationMs,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    responsePreview: t.responsePreview,
  }))

  return {
    runId,
    metrics: {
      requiredCoverage: ratio(requiredCovered, requiredFields),
      effectiveCoverage: ratio(effectiveCovered, effectiveTotal),
      rawBackendFieldCoverage: ratio(fieldsReturned, fieldsTotal),
      endpointsTotal: manifest.endpoints.length,
      endpointsCalled,
      fieldsTotal,
      fieldsReturned,
      requiredFields,
      missingRequiredFields: missingRequiredFields.length,
      ignoredReturnedFields: ignoredReturnedFields.length,
      suspiciousFields: suspiciousCoverage.length,
    },
    missingRequiredFields,
    weakEvidenceFields,
    ignoredReturnedFields,
    suspiciousCoverage,
    endpoints,
    requests,
  }
}
