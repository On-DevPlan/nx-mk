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
