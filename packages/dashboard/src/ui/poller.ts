/**
 * 轮询器（spec §3.4 纯逻辑件，React hook 是薄包装）：
 * start 立即拉一次 + setInterval；refresh 手动触发；stop 清理并 abort 在飞请求。
 * 错误不终止轮询（503 busy / 网络抖动由 UI 轮询自愈，spec §4）。
 */
import { ApiError } from './api'

export const POLL_INTERVAL_MS = 5000

export interface PollerOptions {
  intervalMs?: number
  fetchImpl?: typeof fetch
  onUpdate: (data: unknown) => void
  onError: (err: unknown) => void
}

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight: AbortController | null = null

  constructor(
    private readonly path: string,
    private readonly opts: PollerOptions,
  ) {}

  start(): void {
    if (this.timer !== null) return // 幂等：重复调用不泄漏 interval（hygiene-A3）
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.opts.intervalMs ?? POLL_INTERVAL_MS)
  }

  async refresh(): Promise<void> {
    this.inflight?.abort()
    const controller = new AbortController()
    this.inflight = controller
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(this.path, { signal: controller.signal })
      if (!res.ok) {
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          // 空 body 容忍
        }
        this.opts.onError(new ApiError(res.status, body))
        return
      }
      const data = await res.json()
      if (controller.signal.aborted) return // 被取代的旧响应不回调（hygiene-A4）
      this.opts.onUpdate(data)
    } catch (err) {
      if (controller.signal.aborted) return // 被 stop/新 refresh 取代，不报错
      this.opts.onError(err)
    } finally {
      if (this.inflight === controller) this.inflight = null
    }
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.inflight?.abort()
    this.inflight = null
  }
}
