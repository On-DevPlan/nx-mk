/**
 * @nx-mk/client runtime —— fetch 包装 + 模式切换（Phase 1.5 / X1-A）
 *
 * 设计依据：docx/plan/nx-mk-plan.md §5.3 SDK Facade + §18.2 Middleware
 *
 * 核心模式：
 * - createFetchClient(options): 返回 fetch 包装，记录请求/响应
 * - tracker 0 字节：当前实现只暴露薄壳；analysis 模式 tracker 在 Phase 2 接入
 * - 生产模式：纯 fetch 转发，无任何 analysis 副作用
 *
 * 与 codegen 配合：
 *   - codegen 产出的 endpoints.ts 用 `createFetchClient()` + 内置 api.x.y() 风格
 *   - 用户代码：`import { createFetchClient } from '@nx-mk/client/runtime'`
 *   - 真实项目 `import { api } from './generated-sdk'`（codegen 产物）
 */

import type { ApiManifest } from '@nx-mk/manifest-schema'
import { createNoopCollector, type Collector } from '../collector/index.js'
import { createTrackedProxy } from '../proxy/index.js'
import { matchEndpoint } from '../mode/analysis.js'
import { detectMode } from '../mode/index.js'

// Ruling 6：浏览器侧 collector shim（plugin-playwright addInitScript 注入的单通道，
// 形状见 plugin-playwright 的 COLLECTOR_SHIM_SCRIPT —— hits/traces 缓冲 + hit/trace 方法）。
interface BrowserCollectorShim {
  hits: unknown[]
  traces: unknown[]
  hit(h: unknown): void
  trace(t: unknown): void
}

/**
 * transcribeCollectorShim —— 把浏览器 shim 的 hit/trace 适配为共享 Collector 契约：
 * hit() 缺 requestId/endpointId → 'unknown' 占位（flushDrained 列可空语义已覆盖）；
 * drain 恒空（页内缓冲由插件回捞清空，browser 侧永远不做 IO）。
 * 探针纪律：shim 缺方法/抛错不得影响用户请求 —— 方法调用处已 try/catch 包容。
 */
function browserShimAsCollector(shim: BrowserCollectorShim): Collector {
  return {
    hit(h) {
      try {
        shim.hit({ ...h, requestId: h.requestId ?? 'unknown', endpointId: h.endpointId ?? 'unknown' })
      } catch { /* 页内 shim 异常不破坏业务请求（spec §4 探针语义） */ }
    },
    trace(t) {
      try {
        shim.trace(t)
      } catch { /* 同上 */ }
    },
    evidence: () => {},
    snapshot: () => [],
    drain: () => ({ hits: [], traces: [], evidence: [] }),
    reset: () => {
      try {
        shim.hits.length = 0
        shim.traces.length = 0
      } catch { /* 同上 */ }
    },
  }
}

/**
 * Ruling 6 —— analysis 下 collector 缺省的浏览器回退：
 * window.__MK_COLLECTOR__（plugin-playwright shim）存在 → 经适配成为探针投递口；
 * 无 shim（Node/测试环境）→ noop（drain 恒空，零采集）。
 * 探针纪律恒成立：discover 失败 → noop，不抛。
 */
function resolveDefaultCollector(): Collector {
  try {
    if (typeof window !== 'undefined') {
      const shim = (window as unknown as Record<string, unknown>).__MK_COLLECTOR__ as
        | BrowserCollectorShim
        | undefined
      if (shim && typeof shim.hit === 'function' && typeof shim.trace === 'function') {
        return browserShimAsCollector(shim)
      }
    }
  } catch { /* 环境探测失败 → noop（探针永不破坏业务请求） */ }
  return createNoopCollector()
}

/**
 * Ruling 8 —— manifest 缺省的浏览器全局读取：
 * plugin-playwright addInitScript 注入 window.__MK_MANIFEST__ 后，analysis 分支
 * 优先读它做 matchEndpoint；Node/测试环境无此全局 → undefined（endpointId 'unknown'
 * fallback）。读 globalThis（浏览器域里 window === globalThis），运行期显式探测，
 * 未注入时不抛（探针纪律）。
 */
function getBrowserManifest(): ApiManifest | undefined {
  try {
    const g = globalThis as unknown as Record<string, unknown>
    const m = g.__MK_MANIFEST__ ?? (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).__MK_MANIFEST__ : undefined)
    if (m && typeof m === 'object') return m as ApiManifest
  } catch {
    /* 探测失败 → undefined */
  }
  return undefined
}

export interface FetchClientOptions {
  baseUrl: string
  headers?: Record<string, string>
  // Phase 2 占位：analysis 模式时 tracker 注入点
  mode?: 'production' | 'analysis'
  /** Phase 2：analysis 模式的 collector 注入；缺省 noop（production 恒 noop） */
  collector?: Collector
  /** Phase 2：analysis 模式的 manifest，用于 endpoint 匹配；缺省时 endpointId fallback 'unknown' */
  manifest?: ApiManifest
  onRequest?: (ctx: { method: string; url: string; headers: Record<string, string> }) => void
  onResponse?: (ctx: { method: string; url: string; status: number; durationMs: number }) => void
}

export interface FetchClient {
  /**
   * Execute a generated endpoint call.
   * `params` 由 codegen 生成的 method 签名决定（path/query/body 任意组合），
   * fetch 客户端只负责把 path params 替成 URL、把 body 序列化进 init。
   */
  fetch<T = unknown>(method: string, path: string, params?: unknown): Promise<T>
  raw(input: string, init?: RequestInit): Promise<Response>
}

export function createFetchClient(options: FetchClientOptions): FetchClient {
  // Ruling 6（Task 7 审查）缺省解析：
  // - mode 缺省 → detectMode()（Node/测试环境无 __MK_ANALYSIS__ → production，零开销不变）；
  //   production 分支消费 DetectMode 前的常规解构 —— zero-overhead 语义保持。
  // - analysis 下 collector 缺省 → window.__MK_COLLECTOR__ shim（浏览器）；无 shim → noop
  //   （generated-sdk 产物 createFetchClient({baseUrl}) 零参也能在 demo 采集闭环中工作）。
  // - manifest 缺省 → __MK_MANIFEST__（Ruling 8 编译期注入；缺省 undefined → endpointId 'unknown'）。
  const { baseUrl, headers: baseHeaders = {}, onRequest, onResponse } = options
  const mode = options.mode ?? detectMode()
  const isAnalysis = mode === 'analysis'
  // production 恒 noop：缺省解析只发生在 analysis 分支之后才触碰全局（先求 mode）
  const manifest = options.manifest ?? (isAnalysis ? getBrowserManifest() : undefined)
  const collector = options.collector ?? (isAnalysis ? resolveDefaultCollector() : createNoopCollector())

  return {
    async fetch<T = unknown>(method: string, path: string, params: unknown = {}): Promise<T> {
      // path 内可能含 `${name}` 占位（codegen 产出），运行时按 params 取值替换
      const url = buildUrl(baseUrl, path, isRecord(params) ? params : {})
      const headers: Record<string, string> = { ...baseHeaders }
      let body: BodyInit | undefined
      if (isRecord(params) && 'body' in params && params.body !== undefined) {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
        body = JSON.stringify(params.body)
      } else if (method !== 'GET' && method !== 'HEAD' && params !== undefined) {
        // POST/PUT/PATCH 没显式 body 时：把整个 params 当 body
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
        body = JSON.stringify(params)
      }
      const start = Date.now()
      if (isAnalysis && onRequest) onRequest({ method, url, headers })
      const res = await fetch(url, { method, headers, body })
      const durationMs = Date.now() - start
      if (isAnalysis && onResponse) onResponse({ method, url, status: res.status, durationMs })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${url}`)
      const data = (await res.json()) as T
      if (!isAnalysis) return data
      // —— Phase 2 analysis：trace 记录 + 响应 JSON 经 tracked proxy 包裹返回（spec §3.5）
      // 探针失败隔离：analysis 侧任何异常都不得影响用户响应，兜底返回原始 data
      try {
        const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        const pathname = new URL(url, 'http://localhost').pathname
        const endpointId = matchEndpoint(manifest, pathname, method)
        collector.trace({
          requestId,
          method,
          url,
          endpointId,
          path: pathname,
          status: res.status,
          durationMs,
          startedAt: new Date(start).toISOString(),
          endedAt: new Date().toISOString(),
        })
        if (data !== null && typeof data === 'object') {
          return createTrackedProxy(data as object, {
            requestId,
            endpointId: endpointId ?? 'unknown',
            basePath: 'data',
            collector,
          }) as T
        }
      } catch {
        // containment：trace/proxy 包装失败不影响调用方拿数据
      }
      return data
    },
    async raw(input: string, init?: RequestInit): Promise<Response> {
      return fetch(input, init)
    },
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function buildUrl(base: string, path: string, params: Record<string, unknown>): string {
  // Step 1: 替换 path 内的 `${name}` 占位（codegen 产物）
  const interpolated = path.replace(/\$\{encodeURIComponent\(String\(params\['([^']+)'\]\)\)\}/g, (_, name: string) => {
    const v = params[name]
    return encodeURIComponent(String(v))
  }).replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    // 简单表达式: `params['id']` → 取 params.id
    const m = expr.match(/^params\['([^']+)'\]$/)
    if (m && m[1] !== undefined) {
      const v = params[m[1]]
      return encodeURIComponent(String(v))
    }
    return expr
  })

  // Step 2: 把所有"非 path 字段"当作 query
  // 浏览器场景：baseUrl 常是相对路径（如 '/api'，codegen 产物），而 new URL 的 base
  // 参数必须是绝对 URL —— 相对 base 直接抛 'Invalid base URL'（Phase 2 手动验收发现，
  // demo app 启动即崩）。浏览器相对 base 拼上 location.origin；Node/绝对 URL 行为不变。
  const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost'
  const absBase = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(base) ? base : `${origin}${base}`
  const u = new URL(interpolated.replace(/^\//, ''), absBase.endsWith('/') ? absBase : `${absBase}/`)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    // 已经用作 path param 的不重复加 query
    if (interpolated.includes(`\${encodeURIComponent(String(params['${k}']))}`) ||
        interpolated.includes(`\${params['${k}']}`)) continue
    u.searchParams.set(k, String(v))
  }
  return u.toString()
}
