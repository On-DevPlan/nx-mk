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
}
