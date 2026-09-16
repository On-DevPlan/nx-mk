/**
 * @nx-mk/client/collector —— 采集内存缓冲（spec §3.2）
 * IO 剥离：drain() 交给 SQLite 写入方（@nx-mk/coverage flush）。
 */
export {
  createCollector,
  type Collector,
  type FieldHitCore,
  type RequestTraceCore,
  type UiEvidenceCore,
  type CollectReport,
} from './collector.js'
export { createNoopCollector } from './noop-collector.js'
