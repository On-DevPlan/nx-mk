/**
 * API 响应形状 —— server 路由与 UI 页面共享（spec §3.5）。
 * db 行投影类型 = §25 对应表列的 camelCase 直译，不臆造字段。
 */
import type {
  CoverageReportMetrics,
  FieldCoverageItem,
  RequestTraceSummary,
} from '@nx-mk/coverage'

/** §25.1 runs 行投影（含 Phase 3 ensureColumn 增量列 terminated_by） */
export interface RunRow {
  id: string
  startedAt: string | null
  endedAt: string | null
  status: string
  projectName: string | null
  dashboardUrl: string | null
  manifestHash: string | null
  configPath: string | null
  resolvedConfigPath: string | null
  terminatedBy: string | null
}

/** §25.4 request_traces 行投影 */
export interface TraceRow {
  id: string
  runId: string
  traceId: string
  scenarioId: string | null
  dslStepId: string | null
  endpointId: string | null
  method: string
  url: string
  path: string | null
  status: number | null
  durationMs: number | null
  startedAt: string | null
  endedAt: string | null
  replayable: number | null
  replaySafety: string | null
  replayReason: string | null
}

/** §25.6 field_hits 行投影 */
export interface FieldHitRow {
  id: string
  runId: string
  requestId: string | null
  endpointId: string | null
  fieldId: string | null
  fieldPath: string
  normalizedPath: string
  count: number
  firstHitAt: string | null
  lastHitAt: string | null
  route: string | null
  source: string | null
}

/** §25.7 ui_evidence 行投影（含 Phase 3 增量列 text_sample） */
export interface UiEvidenceRow {
  id: string
  runId: string
  requestId: string | null
  fieldId: string | null
  fieldPath: string
  evidenceType: string | null
  selector: string | null
  visible: number | null
  inViewport: number | null
  route: string | null
  screenshotPath: string | null
  textSample: string | null
}

/** §25.8 coverage_fields 行投影 */
export interface CoverageFieldRow {
  id: string
  runId: string
  fieldId: string
  endpointId: string | null
  fieldPath: string
  policyStatus: string
  coverageState: string
  accessHit: number | null
  uiHit: number | null
  assertionHit: number | null
  suspicious: number | null
  countedRequired: number | null
  countedEffective: number | null
}

/** /api/runs 列表项：目录扫描为主键来源，db 行可选富化（可选键缺省即不出现） */
export interface RunListItem {
  runId: string
  hasEvents: boolean
  hasReport: boolean
  status?: string
  startedAt?: string
  endedAt?: string
  terminatedBy?: string
}

export interface RunsListResponse {
  runs: RunListItem[]
  /** manifest.json 是 workspace 级产物（不随 run），在顶层报告（spec §3.5 修订） */
  manifestAvailable: boolean
}

export interface RunDetailResponse extends RunListItem {
  dbRow: RunRow | null
}

export interface MetricsResponse {
  runId: string
  status?: string
  terminatedBy?: string
  metrics: CoverageReportMetrics
}

export interface RequestsListResponse {
  requests: RequestTraceSummary[]
}

export interface RequestDetailResponse {
  trace: TraceRow
  hits: FieldHitRow[]
  evidence: UiEvidenceRow[]
}

/** db 行为基座 + report 富化（hitCount/matchedRule 不在 §25.8 列中，spec §3.5） */
export type EnrichedCoverageFieldRow = CoverageFieldRow & {
  hitCount?: number
  matchedRule?: FieldCoverageItem['matchedRule']
}

export interface FieldsListResponse {
  fields: EnrichedCoverageFieldRow[]
}

export interface IgnoredListResponse {
  ignored: FieldCoverageItem[]
}

/** 错误响应（404/503） */
export interface ApiErrorResponse {
  error: string
  hint?: string
}
