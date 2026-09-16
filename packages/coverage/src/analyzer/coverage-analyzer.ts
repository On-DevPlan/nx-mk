/**
 * 极简 policy v0（spec D7）：required response 字段未被 field-hit → missing；
 * optional 字段永不进覆盖口径（state='optional-unhit'，不计入 covered 也不进 missing）。
 * 同时把逐字段状态写 coverage_fields 表（§25.8，13 列）。
 */
import type { ApiManifest } from '@nx-mk/manifest-schema'

export interface AnalyzerDb {
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
  }
}

export interface AnalyzeResult {
  total: number
  covered: number
  missing: string[]        // normalized fieldPath
}

export function analyzeCoverage(
  db: AnalyzerDb,
  runId: string,
  manifest: ApiManifest,
  drained: { hits: { normalizedPath: string; count: number }[] },
): AnalyzeResult {
  const hitPaths = new Set(drained.hits.filter((h) => h.count > 0).map((h) => h.normalizedPath))
  const ins = db.prepare(
    `INSERT OR REPLACE INTO coverage_fields
       (id, run_id, field_id, endpoint_id, field_path, policy_status, coverage_state, access_hit, ui_hit, assertion_hit, suspicious, counted_required, counted_effective)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const missing: string[] = []
  let covered = 0
  for (const f of manifest.fields) {
    if (f.direction !== 'response') continue
    const accessHit = hitPaths.has(f.normalizedPath)
    const required = f.required === true
    // D7：coverage_state 只论 required（optional 全部 state='optional-unhit'，不进 missing）
    const state = required ? (accessHit ? 'covered' : 'missing') : 'optional-unhit'
    const countedRequired = required ? 1 : 0
    const countedEffective = required ? 1 : 0
    ins.run(`cf_${runId}_${f.normalizedPath}`, runId, f.id, f.endpointId, f.normalizedPath, 'default', state, accessHit ? 1 : 0, 0, 0, 0, countedRequired, countedEffective)
    if (required && accessHit) covered += 1
    if (required && !accessHit) missing.push(f.normalizedPath)
  }
  const total = manifest.fields.filter((f) => f.direction === 'response').length
  return { total, covered, missing }
}
