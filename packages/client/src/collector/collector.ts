/**
 * collector —— 内存聚合缓冲（纯数据结构无 IO；spec §3.2）
 * hit 按 normalizedPath 聚合 count；snapshot 增量幂等（同 key 且 count 未变不重报）；
 * drain() 是唯一消费口，flush 由 SQLite 写入方（@nx-mk/coverage）调用。
 */

export interface FieldHitCore {
  requestId: string
  endpointId: string
  fieldPath: string
  normalizedPath: string
  type: 'get'
  timestamp: number
}

export interface RequestTraceCore {
  requestId: string
  endpointId?: string
  method: string
  url: string
  path?: string
  status?: number
  durationMs?: number
  startedAt?: string
  endedAt?: string
}

export interface UiEvidenceCore {
  requestId?: string
  fieldId?: string
  fieldPath: string
  evidenceType: 'text'
  selector?: string
  visible: boolean
  inViewport: boolean
  route?: string
}

export interface CollectReport {
  kind: 'field-hit' | 'endpoint-called'
  fieldId?: string
  method?: string
  path?: string
  count: number
  turn: number
}

export interface Collector {
  hit(h: FieldHitCore): void
  trace(t: RequestTraceCore): void
  evidence(ev: UiEvidenceCore): void
  snapshot(turn: number): CollectReport[]
  drain(): { hits: (FieldHitCore & { count: number })[]; traces: RequestTraceCore[]; evidence: UiEvidenceCore[] }
  reset(): void
}

interface HitEntry extends FieldHitCore { count: number }

export function createCollector(): Collector {
  const hitMap = new Map<string, HitEntry>()       // key: normalizedPath
  const reported = new Map<string, number>()       // key: 已 snapshot 时的 count（幂等）
  const traces: RequestTraceCore[] = []
  const reportedTraces = new Set<string>()
  const reportedEndpoints = new Set<string>()   // endpointId 已报（由 hit 侧先报，无 method/path）
  const evidence: UiEvidenceCore[] = []

  return {
    hit(h) {
      const e = hitMap.get(h.normalizedPath)
      if (e) e.count += 1
      else hitMap.set(h.normalizedPath, { ...h, count: 1 })
      // hit 侧也构成 endpoint-called 增量（trace 缺失时的兜底信号）
      if (!reportedTraces.has(h.requestId)) reportedEndpoints.add(h.endpointId)
    },
    trace(t) { traces.push(t) },
    evidence(ev) { evidence.push(ev) },
    snapshot(turn) {
      const out: CollectReport[] = []
      for (const [key, e] of hitMap) {
        if (reported.get(key) !== e.count) {
          out.push({ kind: 'field-hit', fieldId: key, count: e.count, turn })
          reported.set(key, e.count)
        }
      }
      for (const t of traces) {
        if (!reportedTraces.has(t.requestId)) {
          out.push({ kind: 'endpoint-called', method: t.method, path: t.path ?? t.url, count: 1, turn })
          reportedTraces.add(t.requestId)
        }
      }
      for (const ep of reportedEndpoints) {
        if (!reported.has(`ep:${ep}`)) {
          out.push({ kind: 'endpoint-called', count: 1, turn })
          reported.set(`ep:${ep}`, 1)
        }
      }
      return out
    },
    drain() {
      const out = { hits: [...hitMap.values()], traces: [...traces], evidence: [...evidence] }
      hitMap.clear(); reported.clear(); traces.length = 0; reportedTraces.clear(); evidence.length = 0
      return out
    },
    reset() {
      hitMap.clear(); reported.clear(); traces.length = 0; reportedTraces.clear(); evidence.length = 0
    },
  }
}
