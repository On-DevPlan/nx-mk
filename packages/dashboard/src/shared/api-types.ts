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

/** §25.6 field_hits 行投影（含 C1 值通道演进列 value_state/value_type/value_hash） */
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
  /** C1（§23.2）：值状态 present/null/undefined/empty（缺省 null = 旧 run 无此列数据） */
  valueState: string | null
  /** C1（§23.2）：值类型 null/array/string/number/… */
  valueType: string | null
  /** C1：FNV-1a 8 位十六进制单向散列（原文不出浏览器，无可逆泄露） */
  valueHash: string | null
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

// —— 流水线逐步报告（Pipeline 页；数据源 = run 目录 events.jsonl + manifest.json + coverage-report.json）——

/** 单个 phase 步骤（phase:start / phase:end 配对；未结束 durationMs = null） */
export interface PipelinePhaseStep {
  phase: string
  startedAt: string | null
  durationMs: number | null
}

/** goal-loop 单轮覆盖快照（turn:end 事件投影） */
export interface PipelineTurn {
  turn: number
  /** 覆盖率 0..1；无 coverage 载荷为 null */
  ratio: number | null
  covered: number | null
  total: number | null
  progress: string | null
}

/** run 内插件（plugin:loaded / plugin:state-change 合并投影） */
export interface PipelinePlugin {
  name: string
  version: string | null
  state: string | null
}

/** run 内 DSL 场景执行（scenario:start / scenario:done 配对） */
export interface PipelineScenarioStep {
  scenarioId: string
  /** done 未到达 = null（执行中或中断） */
  ok: boolean | null
}

/** goal 终止判定（goal:met / goal:unmet 投影） */
export interface PipelineGoal {
  status: 'met' | 'unmet'
  ratio: number | null
  turns: number | null
  durationMs: number | null
}

/** 分析步骤（coverage-report.json，D12 runId 匹配门控后） */
export interface PipelineAnalysis {
  hasReport: boolean
  requiredCoverage: number | null
  effectiveCoverage: number | null
  rawBackendFieldCoverage: number | null
}

/** manifest 步骤（run 目录 manifest.json 投影） */
export interface PipelineManifest {
  version: string | null
  sourceType: string | null
  endpoints: number | null
  fields: number | null
}

export interface PipelineReportResponse {
  runId: string
  /** 事件流不可读（空/损坏）→ null（诚实降级，页面显空态） */
  phases: PipelinePhaseStep[] | null
  plugins: PipelinePlugin[]
  turns: PipelineTurn[]
  goal: PipelineGoal | null
  scenarios: PipelineScenarioStep[]
  analysis: PipelineAnalysis
  manifest: PipelineManifest | null
}

// —— DSL 场景回放历史（GET /api/scenarios/trails；数据源 = replays/scenarios/**.json）——

/** 单条 trail 的步骤（trail JSON steps 原样投影的窄化） */
export interface ScenarioTrailStep {
  stepId: string
  type: string
  ok: boolean
  durationMs: number
  error?: string
}

export interface ScenarioTrailSummary {
  replayId: string
  scenarioId: string
  ok: boolean
  createdAt: string | null
  steps: ScenarioTrailStep[]
}

export interface ScenarioTrailsResponse {
  trails: ScenarioTrailSummary[]
}

/** trail 详情步骤 = 执行结果 + DSL 输入合并（「具体 I/O」报告） */
export interface ScenarioTrailStepDetail extends ScenarioTrailStep {
  /** DSL 步骤输入（url/selector/urlPattern/field/path/timeoutMs 按类型取）；DSL 不可得 → null */
  input: Record<string, unknown> | null
}

/** GET /api/scenarios/trails/:replayId —— 单条回放报告详情（结果 × DSL 输入） */
export interface ScenarioTrailDetailResponse {
  replayId: string
  scenarioId: string
  ok: boolean
  createdAt: string | null
  steps: ScenarioTrailStepDetail[]
  /** DSL 源文件路径（loadScenarios 返回的 file）；场景已删除/配置不可得 → null */
  dslFile: string | null
}

/** GET /api/runs/:runId/pipeline/events —— events.jsonl 原始事件逐条 I/O（形状门控后原样透出） */
export interface PipelineEventsResponse {
  runId: string
  events: Record<string, unknown>[]
  /** 事件数超出上限截断时 true */
  truncated: boolean
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
