/**
 * React 薄包装：usePolling 把 Poller 状态接进组件树。
 * path 为 null 时不启动（Overview 的两段式拉取：先 runs 后 metrics）。
 */
import { useEffect, useRef, useState } from 'react'
import { Poller } from './poller'

export interface PollingState<T> {
  data: T | null
  error: unknown
}

export function usePolling<T>(path: string | null): PollingState<T> & { refresh: () => void } {
  const [state, setState] = useState<PollingState<T>>({ data: null, error: null })
  const pollerRef = useRef<Poller | null>(null)
  useEffect(() => {
    if (path === null) return
    const poller = new Poller(path, {
      onUpdate: (data) => setState({ data: data as T, error: null }),
      onError: (err) => setState((prev) => ({ data: prev.data, error: err })),
    })
    pollerRef.current = poller
    poller.start()
    return () => {
      poller.stop()
      pollerRef.current = null
    }
  }, [path])
  return { ...state, refresh: () => void pollerRef.current?.refresh() }
}

/**
 * useEventSource（spec R11）：SSE 订阅 /api/events，onEvent 供页面触发立即 refresh。
 * 断线由浏览器 EventSource 自动重连（服务端 retry: 2000）；轮询通道保留（R11 不删）。
 * node 测试环境无 EventSource → 静默 no-op（connected:false），页面渲染不受影响。
 */
export interface SseState {
  connected: boolean
}

export function useEventSource(path: string | null, onEvent?: (evt: unknown) => void): SseState {
  const [connected, setConnected] = useState(false)
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent
  useEffect(() => {
    if (path === null || typeof EventSource === 'undefined') {
      setConnected(false)
      return
    }
    const es = new EventSource(path)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (m) => {
      try {
        cbRef.current?.(JSON.parse(m.data) as unknown)
      } catch {
        // 损坏事件忽略（E7 的 UI 侧对偶）
      }
    }
    return () => es.close()
  }, [path])
  return { connected }
}
