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
  /** 响应值预览（≤500 字符，生产者负责截断）—— dashboard RequestDetail「响应值」区展示 */
  responsePreview?: string
  /** §26 归因（S6）：套件模式 drain 时打标；legacy collect 恒缺席 */
  scenarioId?: string
  dslStepId?: string
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
  /** anti-cheat 空标记判定用文本样本（spec §3.4；截断 80 字符，缺省按 valid 处理） */
  textSample?: string
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
  const reportedEndpoints = new Set<string>()   // 出现过 hit 的 endpointId（兜底信号，去重靠 reported 的 ep: 键）
  const evidence: UiEvidenceCore[] = []

  return {
    hit(h) {
      const e = hitMap.get(h.normalizedPath)
      if (e) e.count += 1
      else hitMap.set(h.normalizedPath, { ...h, count: 1 })
      // hit 侧也构成 endpoint-called 增量（trace 缺失时的兜底信号；去重以 reported 的 ep: 键为准）
      reportedEndpoints.add(h.endpointId)
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
      // trace 侧带 method/path，先于 hit 侧兜底，并把 ep: 键标记为已报，
      // 保证同一 endpointId 在同一 snapshot 内不会产出两份 endpoint-called
      const reqId2ep = new Map<string, string>()   // requestId → endpointId（由 hit 记录，去除重复 requestId 关联）
      for (const e of hitMap.values()) {
        if (e.endpointId && !reqId2ep.has(e.requestId)) reqId2ep.set(e.requestId, e.endpointId)
      }
      for (const t of traces) {
        if (!reportedTraces.has(t.requestId)) {
          out.push({ kind: 'endpoint-called', method: t.method, path: t.path ?? t.url, count: 1, turn })
          reportedTraces.add(t.requestId)
        }
        // trace 覆盖同一 requestId 的 hit 侧兜底（显式 endpointId 或按 requestId 关联）
        const suppressed = (t.endpointId ?? reqId2ep.get(t.requestId)) ?? null
        if (suppressed && !reported.has(`ep:${suppressed}`)) {
          reported.set(`ep:${suppressed}`, 1)
        }
      }
      for (const ep of reportedEndpoints) {
        const k = `ep:${ep}`
        if (!reported.has(k)) {
          out.push({ kind: 'endpoint-called', count: 1, turn })
          reported.set(k, 1)
        }
      }
      return out
    },
    // v0: multi-turn collection should read+clear in a single evaluate to avoid intermediate-push data loss
    drain() {
      const out = { hits: [...hitMap.values()], traces: [...traces], evidence: [...evidence] }
      hitMap.clear(); reported.clear(); traces.length = 0; reportedTraces.clear(); reportedEndpoints.clear(); evidence.length = 0
      return out
    },
    reset() {
      hitMap.clear(); reported.clear(); traces.length = 0; reportedTraces.clear(); reportedEndpoints.clear(); evidence.length = 0
    },
  }
}
