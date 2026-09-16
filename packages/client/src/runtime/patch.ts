/**
 * patchGlobalFetch —— fetch monkey-patch fallback（SDK-CG3b，spec §3.5）
 *
 * 用途（Plan §42.5）：项目装了 @mk/client 但没全量迁移时，未替换的裸 fetch()
 * 也走统一探针缝，coverage 不丢失。Phase 1.5 只落机制：命中 apiPrefix 时回调
 * onCapture（Phase 2 collector 在此接入），随后无条件委托原 fetch。
 *
 * 约束：
 * - 幂等：已 patch 时再次调用直接返回 no-op unpatch，不叠加包裹
 * - 探针异常不得影响业务请求（try/catch 吞掉）
 * - globalThis.fetch 不存在的环境直接返回 no-op
 */

export interface PatchGlobalFetchOptions {
  /** API 路径前缀，默认 '/api'（与 codegen baseUrl 对齐） */
  apiPrefix?: string
  /** 命中前缀的请求回调（Phase 2 collector 接入点） */
  onCapture?: (info: { method: string; url: string }) => void
}

// 模块级单例：同一时刻最多一层包裹
let activeUnpatch: (() => void) | null = null

export function patchGlobalFetch(options: PatchGlobalFetchOptions = {}): () => void {
  if (activeUnpatch) return () => {} // 幂等：不叠加

  const g = globalThis as { fetch?: typeof fetch }
  const original = g.fetch
  if (typeof original !== 'function') return () => {}

  const apiPrefix = options.apiPrefix ?? '/api'
  const onCapture = options.onCapture

  const patched = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const rawMethod = init?.method ?? (input instanceof Request ? input.method : 'GET')
      const method = rawMethod.toUpperCase()
      // 与 migrate 引擎同口径：前缀须整段命中（/api 或 /api/...），/apiv2 不算
      const { pathname } = new URL(url, 'http://localhost')
      const hit = pathname === apiPrefix || pathname.startsWith(`${apiPrefix}/`)
      if (hit) onCapture?.({ method, url })
    } catch {
      // 探针解析失败不影响业务请求
    }
    return original.call(globalThis, input, init)
  }) as typeof fetch

  g.fetch = patched
  activeUnpatch = () => {
    g.fetch = original
    activeUnpatch = null
  }
  return activeUnpatch
}
