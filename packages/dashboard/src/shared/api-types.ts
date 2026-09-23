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
  /** 响应值预览（§3.1 演进列 response_preview，≤500 字符；无则 null） */
  responsePreview: string | null
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

// —— Phase 4.5：Replay Request（spec §2.1/R1-R5；plan §27.2 ReplaySafety v0 子集）——

export type ReplayVerdict = 'safe' | 'idempotent' | 'unsafe' | 'blocked'

/** POST /api/runs/:runId/replay/request/:requestId 响应（R4：replay-error 也是 200） */
export interface ReplayResponse {
  /** 留痕文件 ID（= 文件名去 .json）；留痕写失败为 null（结果仍返回） */
  replayId: string | null
  verdict: ReplayVerdict
  reason: string
  ok: boolean
  status: number | 'replay-error' | null
  durationMs: number | null
  /** 响应 body 前 500 字符（R5 截断规则）；replay-error 时 null */
  bodyPreview: string | null
  /** replay-error 时的错误摘要（E3） */
  error?: string
}

/** GET /api/runs/:runId/replays —— 留痕列表（v0 扩展路由，§30.2 未列） */
export interface ReplaySummary {
  replayId: string
  verdict: ReplayVerdict
  ok: boolean
  status: number | 'replay-error' | null
  createdAt: string
}
export interface ReplaysListResponse {
  replays: ReplaySummary[]
}

// —— Phase 4.5：plugin settings 只读（spec R6-R8/E4/E5；V5 config 语义）——

export interface PluginEntryView {
  name: string
  version: string
  enabled: boolean
  /** per-plugin 配置（V5'）；插件不在 plugins 列表 → null */
  config: unknown
  /** JSON Schema 对象；无/不可序列化 → null（UI 显「No schema exposed」，R8/E5） */
  configSchema: Record<string, unknown> | null
}

export interface PluginsResponse {
  plugins: PluginEntryView[]
  /** true = plugins-manifest.json 缺失/形状不过（E4）：UI 显「kernel 未产出清单」 */
  stale: boolean
}

// —— Phase 4.5：manifest 浏览器（spec U6/E8；§16 ApiManifest 结构投影，不引 manifest-schema 依赖）——

export interface ManifestEndpointView {
  id: string
  method: string
  path: string
  operationId?: string
  summary?: string
  tags?: string[]
}

export interface ManifestFieldView {
  id: string
  endpointId: string
  direction: string
  status?: string
  path: string
  normalizedPath: string
  name: string
  type: string
  required?: boolean
  nullable?: boolean
  description?: string
  enum?: string[]
}

export interface ManifestResponse {
  version: string
  source: { type: string; input: string; hash: string }
  generatedAt: string
  schemas: Record<string, unknown>
  fields: ManifestFieldView[]
  endpoints: ManifestEndpointView[]
}

// —— v1：plugin config 写回链（spec §2.1/§2.3 + E1-E7 矩阵；WP1 写回本体在 @nx-mk/config）——

/** PATCH /api/plugins/:name/config?dryRun=true 响应（spec §2.1/§2.3；WP2：errors 恒 []，形状门在路由层） */
export interface ConfigWritePreviewResponse {
  valid: boolean
  errors: string[]
  newYaml: string
  yamlSha: string
  diff: string
}

/** PATCH …?dryRun=false 响应（W6：.bak 单代备份 + 原子写） */
export interface ConfigWriteApplyResponse {
  applied: true
  diff: string
  bakPath: string
  yamlSha: string
}

// —— v1：scenario DSL 浏览页 + 回放（spec S3/S11/S12；§26/§27）——

/** GET /api/scenarios（spec S11 —— 无 scenarios 段诚实降级） */
export interface ScenarioView {
  id: string
  name: string
  route?: string
  stepCount: number
  file: string
}
export interface ScenariosResponse {
  enabled: boolean
  scenarios: ScenarioView[]
}

/** POST /api/runs/:runId/replay/scenario/:scenarioId（spec S3/S12） */
export interface StepResultView {
  stepId: string
  type: string
  ok: boolean
  durationMs: number
  error?: string
}
export interface ScenarioReplayResponse {
  replayId: string
  scenarioId: string
  ok: boolean
  steps: StepResultView[]
  createdAt: string
  trailWritten: boolean
}
