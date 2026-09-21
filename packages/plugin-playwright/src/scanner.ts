/**
 * scanner —— 注入浏览器的 DOM 扫描脚本 + 评估结果防御性解析（spec §3.4）
 *
 * PAGE_SCAN_SCRIPT 是在浏览器 page.evaluate 执行的字面脚本字符串（必须是
 * 可序列化、无闭包依赖的纯表达式），产出 DomFieldDescriptor 原始数组；
 * toDescriptors 在 Node 侧对 evaluate 输出做防御性解析：非数组 or 畸形条目
 * 静默过滤，保证 scanDom 的输入契约。
 *
 * Ruling 7（Task 7 审查）：另承载浏览器侧 collector shim 注入脚本与 Node 侧
 * 回捞 —— 放本模块（playwright-free）以保持纯函数可测性。
 */
import type { Collector, FieldHitCore, RequestTraceCore } from '@nx-mk/client/collector'

// 注入脚本：逐项读 data-mk-field 属性、可见性与视口相交性。
// 注意脚本内不能引用模块变量 —— 全部走 document/window。
export const PAGE_SCAN_SCRIPT = `(() => {
  const els = Array.from(document.querySelectorAll('[data-mk-field]'))
  const mkVisible = (el) => {
    const style = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const mkInViewport = (el) => {
    const rect = el.getBoundingClientRect()
    // 相交语义（spec §3.4）：rect 与视口有重叠即算，不要求完全包含
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth)
    )
  }
  return els.map((el) => ({
    dataMkField: el.getAttribute('data-mk-field') || '',
    visible: mkVisible(el),
    inViewport: mkInViewport(el),
    // anti-cheat 空标记判定样本（spec §3.4）：textContent 可能为 null —— 先归空串
    // 再 trim 截断 80（与 UiEvidenceCore.textSample 的截断契约对齐）
    text: ((el.textContent || '') + '').trim().slice(0, 80),
  }))
})()`

/** page.evaluate 输出的原始描述符形状（全部可选 —— 信任边界外的数据） */
interface RawDescriptor {
  dataMkField?: unknown
  visible?: unknown
  inViewport?: unknown
  text?: unknown
}

export interface ParsedDescriptor {
  dataMkField: string
  visible: boolean
  inViewport: boolean
  /** 元素 textContent 样本（≤80 字符）—— scanDom 透传为 UiEvidenceCore.textSample */
  text: string
}

/**
 * toDescriptors —— 防御性解析 page.evaluate 产物：
 * 非数组输入返回 []；缺字段/类型不符的条目整条过滤（dataMkField 必须 string）。
 */
export function toDescriptors(raw: unknown): ParsedDescriptor[] {
  if (!Array.isArray(raw)) return []
  const out: ParsedDescriptor[] = []
  for (const item of raw as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const d = item as RawDescriptor
    if (typeof d.dataMkField !== 'string') continue
    out.push({
      dataMkField: d.dataMkField,
      visible: d.visible === true,
      inViewport: d.inViewport === true,
      text: typeof d.text === 'string' ? d.text.slice(0, 80) : '',
    })
  }
  return out
}

/**
 * scanPage —— DOM 扫描步骤的包容边界（spec §4 row 3）：
 * evaluate 注入脚本失败时【不向 Goal Loop 传播】—— 回调 onScanError 供上层
 * warn，本 turn 的 evidence 为 []。goto / waitForSelector 的失败不经过此处
 * （保持 spec §4 row 2 的 fail-fast）。
 *
 * 放在 scanner.ts（而非 runner.ts）以保持纯函数可测性 —— 单测可用拒绝的
 * evaluate 桩直接驱动，playwright-core 不参与。
 */
export async function scanPage(
  evaluate: (script: string) => Promise<unknown>,
  onScanError?: (err: unknown) => void,
): Promise<ParsedDescriptor[]> {
  try {
    return toDescriptors(await evaluate(PAGE_SCAN_SCRIPT))
  } catch (err) {
    onScanError?.(err)
    return []
  }
}

/**
 * Ruling 7 —— 浏览器侧 collector shim（addInitScript 注入的字面脚本）：
 * 页内 `window.__MK_COLLECTOR__` 单通道缓冲 —— demo 业务代码（Ruling 6 缺省解析）
 * 从 analysis 分支 hit()/trace() 进这里；Node 侧 launchCollect 在页面工作完成后
 * 经 drainBrowserCollector 回捞进共享 collector，再清空页内缓冲。
 * 注意：shim 必须无 Node 依赖（buffer 只是普通数组），故可序列化注入。
 */
export const COLLECTOR_SHIM_SCRIPT = `(() => {
  if (window.__MK_COLLECTOR__) return
  window.__MK_COLLECTOR__ = {
    hits: [],
    traces: [],
    hit(h) { this.hits.push(h) },
    trace(t) { this.traces.push(t) },
  }
})()`

/** 页内 shim 缓冲的原始条目形状（信任边界外 —— 全部可选，回捞侧防御性过滤） */
interface BrowserShimWindow {
  __MK_COLLECTOR__?: {
    hits: unknown[]
    traces: unknown[]
  }
}

/**
 * drainBrowserCollector —— Node 侧回捞（Ruling 7）：
 * page.evaluate 读页内 shim 的 hits/traces（原始信任边界外数据）→ 防御性过滤
 * → collector.hit/trace 投进共享 collector。hygiene-sweep H8：读与清空在
 * 同一次 evaluate 内原子完成，消除 read/clear 窗口丢条目。
 * 探针纪律：evaluate 或解析失败只静默空回捞（回捞缺失不阻断收集通路 —— DOM
 * evidence 通道不受影响；spec §4 的 trace/flush 失败语义不受此影响）。
 *
 * flush 输入端契约：hits 需带 count（drained 契约）—— 回捞侧补 count=1
 * （页内 shim 每次读取 push 1 条，聚合在共享 collector 侧按 normalizedPath 完成）。
 */
export interface DrainTag {
  scenarioId: string
  dslStepId?: string
}

export async function drainBrowserCollector(
  evaluate: (fn: unknown) => Promise<unknown>,
  collector: Collector,
  tag?: DrainTag,
): Promise<void> {
  // hygiene-sweep H8：读与清空合并为单次 evaluate（原 v0 两次独立 evaluate 的
  // 中间窗口内页面新 push 条目会丢 —— 现在同一脚本内先 slice 再清空，消除窗口）。
  // 读回捞脚本：slice 后立即原引用清空（保序 —— 页面代码可能另持引用）。
  const DRAIN_SHIM =
    '(() => { const c = window.__MK_COLLECTOR__; if (!c) return null; const hits = c.hits.slice(); const traces = c.traces.slice(); c.hits.length = 0; c.traces.length = 0; return { hits, traces } })()'
  try {
    const raw = (await evaluate(DRAIN_SHIM)) as BrowserShimWindow['__MK_COLLECTOR__']
    if (!raw || !Array.isArray(raw.hits) || !Array.isArray(raw.traces)) return
    for (const h of raw.hits) {
      if (!h || typeof h !== 'object') continue
      const hit = h as Partial<FieldHitCore>
      if (typeof hit.normalizedPath !== 'string' || hit.normalizedPath === '') continue
      collector.hit({
        requestId: typeof hit.requestId === 'string' ? hit.requestId : '(unknown)',
        endpointId: typeof hit.endpointId === 'string' ? hit.endpointId : '(unknown)',
        fieldPath: typeof hit.fieldPath === 'string' ? hit.fieldPath : hit.normalizedPath,
        normalizedPath: hit.normalizedPath,
        type: 'get',
        timestamp: typeof hit.timestamp === 'number' ? hit.timestamp : Date.now(),
      } satisfies FieldHitCore)
    }
    for (const t of raw.traces) {
      if (!t || typeof t !== 'object') continue
      const trace = t as Partial<RequestTraceCore>
      if (typeof trace.url !== 'string' || typeof trace.method !== 'string') continue
      collector.trace({
        requestId: typeof trace.requestId === 'string' ? trace.requestId : `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        endpointId: typeof trace.endpointId === 'string' ? trace.endpointId : undefined,
        method: trace.method,
        url: trace.url,
        path: typeof trace.path === 'string' ? trace.path : undefined,
        status: typeof trace.status === 'number' ? trace.status : undefined,
        durationMs: typeof trace.durationMs === 'number' ? trace.durationMs : undefined,
        startedAt: typeof trace.startedAt === 'string' ? trace.startedAt : undefined,
        endedAt: typeof trace.endedAt === 'string' ? trace.endedAt : undefined,
        // §26 归因（S6）：tag 存在时该批 trace 打标；hits 不打标（FieldHitCore 无字段）
        ...(tag ? { scenarioId: tag.scenarioId, ...(tag.dslStepId !== undefined ? { dslStepId: tag.dslStepId } : {}) } : {}),
      } satisfies RequestTraceCore)
    }
    // 清空已在同一脚本内完成（先于 snapshot 增量去重消费）
  } catch {
    // 回捞失败 → 空（不阻断；DOM evidence 通道独立）
  }
}
