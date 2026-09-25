/**
 * 五表查询投影（spec §3.1）：SELECT * + 显式 snake→camel 映射，
 * 列集 = §25.1/25.4/25.6/25.7/25.8 逐列（schema 漂移由 Task 0 附注锁定）。
 * DbBusyError 原样上抛（路由层捕获），其余 SQL 错误上抛（fastify 500 可见）。
 */
import type { CoverageDbReader } from './db-reader.js'
import type { RunRow, TraceRow, FieldHitRow, UiEvidenceRow, CoverageFieldRow } from '../../shared/api-types.js'

type Row = Record<string, unknown>

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function mapRunRow(r: Row): RunRow {
  return {
    id: String(r.id),
    startedAt: str(r.started_at),
    endedAt: str(r.ended_at),
    status: String(r.status),
    projectName: str(r.project_name),
    dashboardUrl: str(r.dashboard_url),
    manifestHash: str(r.manifest_hash),
    configPath: str(r.config_path),
    resolvedConfigPath: str(r.resolved_config_path),
    terminatedBy: str(r.terminated_by),
  }
}

function mapTraceRow(r: Row): TraceRow {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    traceId: String(r.trace_id),
    scenarioId: str(r.scenario_id),
    dslStepId: str(r.dsl_step_id),
    endpointId: str(r.endpoint_id),
    method: String(r.method),
    url: String(r.url),
    path: str(r.path),
    status: int(r.status),
    durationMs: int(r.duration_ms),
    startedAt: str(r.started_at),
    endedAt: str(r.ended_at),
    replayable: int(r.replayable),
    replaySafety: str(r.replay_safety),
    replayReason: str(r.replay_reason),
    responsePreview: str(r.response_preview),
  }
}

function mapHitRow(r: Row): FieldHitRow {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    requestId: str(r.request_id),
    endpointId: str(r.endpoint_id),
    fieldId: str(r.field_id),
    fieldPath: String(r.field_path),
    normalizedPath: String(r.normalized_path),
    count: Number(r.count),
    firstHitAt: str(r.first_hit_at),
    lastHitAt: str(r.last_hit_at),
    route: str(r.route),
    source: str(r.source),
    valueState: str(r.value_state),
    valueType: str(r.value_type),
    valueHash: str(r.value_hash),
  }
}

function mapEvidenceRow(r: Row): UiEvidenceRow {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    requestId: str(r.request_id),
    fieldId: str(r.field_id),
    fieldPath: String(r.field_path),
    evidenceType: str(r.evidence_type),
    selector: str(r.selector),
    visible: int(r.visible),
    inViewport: int(r.in_viewport),
    route: str(r.route),
    screenshotPath: str(r.screenshot_path),
    textSample: str(r.text_sample),
  }
}

function mapCoverageFieldRow(r: Row): CoverageFieldRow {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    fieldId: String(r.field_id),
    endpointId: str(r.endpoint_id),
    fieldPath: String(r.field_path),
    policyStatus: String(r.policy_status),
    coverageState: String(r.coverage_state),
    accessHit: int(r.access_hit),
    uiHit: int(r.ui_hit),
    assertionHit: int(r.assertion_hit),
    suspicious: int(r.suspicious),
    countedRequired: int(r.counted_required),
    countedEffective: int(r.counted_effective),
  }
}

export class Queries {
  constructor(private readonly reader: CoverageDbReader) {}

  getRun(runId: string): RunRow | undefined {
    const r = this.reader.get<Row>('SELECT * FROM runs WHERE id = ?', runId)
    return r === undefined ? undefined : mapRunRow(r)
  }

  listRuns(): RunRow[] {
    return this.reader.all<Row>('SELECT * FROM runs ORDER BY started_at').map(mapRunRow)
  }

  listTraces(runId: string): TraceRow[] {
    return this.reader
      .all<Row>('SELECT * FROM request_traces WHERE run_id = ? ORDER BY started_at', runId)
      .map(mapTraceRow)
  }

  getTrace(runId: string, traceId: string): TraceRow | undefined {
    const r = this.reader.get<Row>(
      'SELECT * FROM request_traces WHERE run_id = ? AND trace_id = ?',
      runId, traceId,
    )
    return r === undefined ? undefined : mapTraceRow(r)
  }

  listHitsByRequest(runId: string, requestId: string): FieldHitRow[] {
    return this.reader
      .all<Row>('SELECT * FROM field_hits WHERE run_id = ? AND request_id = ? ORDER BY last_hit_at', runId, requestId)
      .map(mapHitRow)
  }

  listEvidenceByRequest(runId: string, requestId: string): UiEvidenceRow[] {
    return this.reader
      .all<Row>('SELECT * FROM ui_evidence WHERE run_id = ? AND request_id = ? ORDER BY field_path', runId, requestId)
      .map(mapEvidenceRow)
  }

  listCoverageFields(runId: string): CoverageFieldRow[] {
    return this.reader
      .all<Row>('SELECT * FROM coverage_fields WHERE run_id = ? ORDER BY field_path', runId)
      .map(mapCoverageFieldRow)
  }
}
