/**
 * @nx-mk/coverage —— SQLite 采集落盘（spec §3.3）
 */
export { openCoverageDb, CoverageDb, type FlushInput, type DrainedHit } from './db/client.js'
export { SCHEMA_SQL, TABLE_NAMES } from './db/schema.js'
export { scanDom, type DomFieldDescriptor } from './evidence/dom-scanner.js'
export { classifyEvidence, type EvidenceQuality, type ClassifiableEvidence } from './anti-cheat/index.js'
export {
  analyzeCoverage,
  type AnalyzerDb,
  type AnalyzeDrained,
  type AnalyzeInput,
  type CoverageReport,
  type CoverageReportMetrics,
  type FieldCoverageItem,
  type EndpointCoverage,
} from './analyzer/index.js'
