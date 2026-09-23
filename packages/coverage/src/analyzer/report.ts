/** §28.2 CoverageReport 形状（spec §3.3）—— Phase 4 Dashboard 的数据契约起点（D7） */
export interface FieldCoverageItem {
  fieldId: string
  fieldPath: string
  endpointId?: string
  state: 'covered' | 'missing' | 'ignored' | 'notApplicable'
  policyStatus: 'required' | 'optional' | 'ignored' | 'unknown'
  hitCount?: number
  matchedRule?: { source: string; pattern: string; reason?: string }
}
export interface EndpointCoverage {
  endpointId: string
  method: string
  path: string
  called: boolean
  fieldsTotal: number
  fieldsCovered: number
}
/**
 * §28.2 requests 摘要（Task 7 审查裁定：契约完整性）—— drained.traces 的逐请求投影。
 * 字段集 = §23.1 RequestTrace 核心列（与 §25.4 request_traces 落库列对齐）；
 * 全部可选：trace 缺失的字段保持缺省（JSON 序列化时省略），不臆造数据。
 */
export interface RequestTraceSummary {
  requestId?: string
  endpointId?: string
  method?: string
  url?: string
  path?: string
  status?: number
  durationMs?: number
  startedAt?: string
  endedAt?: string
  /** 响应值预览（≤500 字符；dashboard RequestDetail 回落路径的数据来源） */
  responsePreview?: string
}
export interface CoverageReportMetrics {
  requiredCoverage: number
  effectiveCoverage: number
  rawBackendFieldCoverage: number
  endpointsTotal: number
  endpointsCalled: number
  fieldsTotal: number
  fieldsReturned: number
  requiredFields: number
  missingRequiredFields: number
  ignoredReturnedFields: number
  suspiciousFields: number
}
export interface CoverageReport {
  runId: string
  metrics: CoverageReportMetrics
  missingRequiredFields: FieldCoverageItem[]
  weakEvidenceFields: FieldCoverageItem[]
  ignoredReturnedFields: FieldCoverageItem[]
  suspiciousCoverage: FieldCoverageItem[]
  endpoints: EndpointCoverage[]
  requests: RequestTraceSummary[]
}
