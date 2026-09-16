/**
 * production 占位 collect —— 全 no-op（零开销；spec §1.2-5 回归锁死目标）
 */
import type { Collector } from './collector.js'

export function createNoopCollector(): Collector {
  const noop = () => {}
  const empty = () => ({ hits: [], traces: [], evidence: [] })
  return { hit: noop, trace: noop, evidence: noop, snapshot: () => [], drain: empty, reset: noop }
}
