/**
 * API 客户端（spec §3.4）：getJson 纯 fetch 包装 + ApiError 携带服务端 hint。
 * 错误态由 usePolling 捕获后交给页面渲染（404 空态 / 503 重试提示）。
 */
import type { ApiErrorResponse } from '../shared/api-types.js'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`)
    this.name = 'ApiError'
  }

  get hint(): string | undefined {
    return (this.body as ApiErrorResponse | null)?.hint
  }

  get serverError(): string | undefined {
    return (this.body as ApiErrorResponse | null)?.error
  }

  /** B6：非 404 错误态的展示文案 —— 优先服务端 detail/error，缺省降级为 HTTP reason */
  get detailMessage(): string {
    const b = this.body as { detail?: unknown; error?: unknown } | null
    return typeof b?.detail === 'string' ? b.detail : typeof b?.error === 'string' ? b.error : 'request failed'
  }
}

export async function getJson<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(path)
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // 空/非 JSON body 容忍——hint 缺省
    }
    throw new ApiError(res.status, body)
  }
  return (await res.json()) as T
}
