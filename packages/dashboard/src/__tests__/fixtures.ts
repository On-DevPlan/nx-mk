/**
 * Dashboard 测试夹具（hermetic）：tmp 目录搭 .nx-mk 形状。
 * 文件级函数在本文件（Task 2）；db 播种 seedDb 由 Task 3 追加。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CoverageReport } from '@nx-mk/coverage'
import { openCoverageDb } from '@nx-mk/coverage'

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

/** db 播种形状：全部可选，按需给行 */
export interface DbSeed {
  dbFileName?: string                       // 默认 coverage.db（测试可另建库名）
  runs?: { id: string; status?: string; terminatedBy?: string | null; startedAt?: string; endedAt?: string | null }[]
  traces?: { runId: string; traceId: string; method?: string; url?: string; path?: string | null; status?: number | null; durationMs?: number | null; startedAt?: string | null }[]
  hits?: { runId: string; requestId?: string | null; fieldPath: string; normalizedPath?: string; count?: number }[]
  evidence?: { runId: string; requestId?: string | null; fieldPath: string; visible?: boolean; textSample?: string | null }[]
  coverageFields?: { runId: string; fieldId?: string; fieldPath: string; policyStatus?: string; coverageState?: string; accessHit?: number; uiHit?: number }[]
}

/**
 * 直接 SQL 播种（绕开 Core 类型，列级精确控制）；
 * openCoverageDb 只用来建表 + ensureColumn 加列，随后立刻用裸 prepare 插行。
 */
export function seedDb(nxMkDir: string, seed: DbSeed): string {
  const dbPath = join(nxMkDir, seed.dbFileName ?? 'coverage.db')
  const db = openCoverageDb(dbPath)
  try {
    for (const r of seed.runs ?? []) {
      db.prepare('INSERT OR REPLACE INTO runs (id, started_at, ended_at, status, terminated_by) VALUES (?, ?, ?, ?, ?)')
        .run(r.id, r.startedAt ?? '2026-09-17T10:00:00.000Z', r.endedAt ?? null, r.status ?? 'completed', r.terminatedBy ?? null)
    }
    for (const t of seed.traces ?? []) {
      db.prepare(
        'INSERT OR REPLACE INTO request_traces (id, run_id, trace_id, scenario_id, dsl_step_id, endpoint_id, method, url, path, status, duration_ms, started_at, ended_at, replayable, replay_safety, replay_reason) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)',
      ).run(
        `rt_${t.runId}_${t.traceId}`, t.runId, t.traceId,
        t.method ?? 'GET', t.url ?? `http://local/${t.traceId}`, t.path ?? null,
        t.status ?? 200, t.durationMs ?? null, t.startedAt ?? null, t.startedAt ?? null,
      )
    }
    for (const h of seed.hits ?? []) {
      db.prepare(
        "INSERT OR REPLACE INTO field_hits (id, run_id, request_id, endpoint_id, field_id, field_path, normalized_path, count, first_hit_at, last_hit_at, route, source) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, NULL, 'proxy')",
      ).run(
        `fh_${h.runId}_${h.fieldPath}`, h.runId, h.requestId ?? null,
        h.fieldPath, h.normalizedPath ?? h.fieldPath, h.count ?? 1,
      )
    }
    for (const e of seed.evidence ?? []) {
      db.prepare(
        "INSERT OR REPLACE INTO ui_evidence (id, run_id, request_id, field_id, field_path, evidence_type, selector, visible, in_viewport, route, screenshot_path, text_sample) VALUES (?, ?, ?, NULL, ?, 'text', NULL, ?, 1, NULL, NULL, ?)",
      ).run(
        `ue_${h0(e.runId, e.fieldPath)}`, e.runId, e.requestId ?? null,
        e.fieldPath, e.visible === false ? 0 : 1, e.textSample ?? null,
      )
    }
    for (const c of seed.coverageFields ?? []) {
      db.prepare(
        'INSERT OR REPLACE INTO coverage_fields (id, run_id, field_id, endpoint_id, field_path, policy_status, coverage_state, access_hit, ui_hit, assertion_hit, suspicious, counted_required, counted_effective) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, ?)',
      ).run(
        `cf_${c.runId}_${c.fieldPath}`, c.runId, c.fieldId ?? c.fieldPath, c.fieldPath,
        c.policyStatus ?? 'required', c.coverageState ?? 'covered',
        c.accessHit ?? 1, c.uiHit ?? 0, c.accessHit ?? 1, c.uiHit ?? 0,
      )
    }
  } finally {
    db.close()
  }
  return dbPath
}

// 命名辅助：fieldPath 含点号直接用于 id（仅 fixture 内保证唯一即可）
function h0(runId: string, fieldPath: string): string {
  return `${runId}_${fieldPath}`
}
