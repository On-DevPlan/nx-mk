/**
 * Dashboard 测试夹具（hermetic）：tmp 目录搭 .nx-mk 形状。
 * 文件级函数在本文件（Task 2）；db 播种 seedDb 由 Task 3 追加。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CoverageReport } from '@nx-mk/coverage'

/** 建 .nx-mk + runs 子目录并返回 .nx-mk 目录本身；withEvents 的 run 写空 events.jsonl */
export function makeNxMkDir(runs: { runId: string; withEvents?: boolean }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'nx-mk-dash-'))
  const nx = join(dir, '.nx-mk')
  mkdirSync(nx, { recursive: true })
  for (const r of runs) {
    mkdirSync(join(nx, 'runs', r.runId), { recursive: true })
    if (r.withEvents) writeFileSync(join(nx, 'runs', r.runId, 'events.jsonl'), '')
  }
  return nx
}

/** demo 语义的报告 fixture（对齐 Phase 3 实测口径：required 100% / raw ~36%） */
export function reportFixture(runId: string, overrides: Partial<CoverageReport> = {}): CoverageReport {
  return {
    runId,
    metrics: {
      requiredCoverage: 1,
      effectiveCoverage: 1,
      rawBackendFieldCoverage: 0.36,
      endpointsTotal: 1,
      endpointsCalled: 1,
      fieldsTotal: 8,
      fieldsReturned: 8,
      requiredFields: 7,
      missingRequiredFields: 0,
      ignoredReturnedFields: 1,
      suspiciousFields: 0,
    },
    missingRequiredFields: [],
    weakEvidenceFields: [],
    ignoredReturnedFields: [
      {
        fieldId: 'data.internalRiskScore',
        fieldPath: 'data.internalRiskScore',
        state: 'ignored',
        policyStatus: 'ignored',
        hitCount: 1,
        matchedRule: { source: 'user-config', pattern: 'data.internalRiskScore' },
      },
    ],
    suspiciousCoverage: [],
    endpoints: [
      { endpointId: 'ep_getUser', method: 'GET', path: '/users/{id}', called: true, fieldsTotal: 8, fieldsCovered: 7 },
    ],
    requests: [
      {
        requestId: 'req_1', endpointId: 'ep_getUser', method: 'GET',
        url: 'http://localhost:8787/users/1', path: '/users/1', status: 200, durationMs: 12,
        startedAt: '2026-09-17T10:00:01.000Z', endedAt: '2026-09-17T10:00:01.012Z',
      },
    ],
    ...overrides,
  }
}

export function writeReportFile(nxMkDir: string, report: CoverageReport): void {
  writeFileSync(join(nxMkDir, 'coverage-report.json'), JSON.stringify(report, null, 2))
}
