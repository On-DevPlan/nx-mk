/**
 * coverage-report.json 读取（spec §3.1）：形状门控（手法同 run.ts isManifestShaped）
 * + runId 匹配门控（D12：report 是最新 run 的覆盖写产物，旧 run 查询按缺失处理）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CoverageReport } from '@nx-mk/coverage'

export function readCoverageReport(nxMkDir: string): CoverageReport | null {
  let raw: string
  try {
    raw = readFileSync(join(nxMkDir, 'coverage-report.json'), 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return isReportShaped(parsed) ? parsed : null
}

function isReportShaped(v: unknown): v is CoverageReport {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.runId !== 'string') return false
  if (typeof o.metrics !== 'object' || o.metrics === null) return false
  const m = o.metrics as Record<string, unknown>
  for (const k of ['requiredCoverage', 'effectiveCoverage', 'rawBackendFieldCoverage'] as const) {
    if (typeof m[k] !== 'number') return false
  }
  // 六个数组缺省补 []（写入解析产物——所有权已归本进程）
  for (const k of [
    'missingRequiredFields', 'weakEvidenceFields', 'ignoredReturnedFields',
    'suspiciousCoverage', 'endpoints', 'requests',
  ]) {
    if (!Array.isArray(o[k])) o[k] = []
  }
  return true
}

/** runId 匹配门控：report.runId ≠ 查询目标 → 按缺失（spec §3.1/D12） */
export function reportForRun(nxMkDir: string, runId: string): CoverageReport | null {
  const r = readCoverageReport(nxMkDir)
  return r !== null && r.runId === runId ? r : null
}
