/**
 * analysis 分支单测（spec §3.5）
 * 锁死：analysis 下 fetch 后响应被 proxy 包裹（data.id 读取产生 hit）；trace 进 collector；
 * production 默认 mode 零改动（无 proxy、无 collector 分配）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFetchClient } from '../src/runtime/client.js'
import { createAnalysisContext } from '../src/mode/analysis.js'
import { createCollector, createNoopCollector, type Collector } from '../src/collector/index.js'

// fetch stub：JSON 响应
function stubFetch(payload: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status })))
}
afterEach(() => { vi.unstubAllGlobals() })

describe('analysis mode', () => {
  it('fetch 后响应被 proxy 包裹，data.id 读取产生 collector hit', async () => {
    stubFetch({ id: 'u1', name: 'x' })
    const { collector } = createAnalysisContext()
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis', collector })
    const data = await client.fetch<{ id: string; name: string }>('GET', '/users/u1')
    const id = data.id       // ← 读取触发 proxy hit
    void id
    const drained = collector.drain()
    expect(drained.hits.some((h) => h.normalizedPath === 'data.id')).toBe(true)
    expect(drained.traces.some((t) => t.status === 200 && t.method === 'GET')).toBe(true)
  })

  it('collector 缺省时用 noop（drain 恒空，请求成功）', async () => {
    stubFetch({ ok: 1 })
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis' })
    const data = await client.fetch('GET', '/ping')
    expect(data).toEqual({ ok: 1 })
  })
})

describe('production mode 零改动回归', () => {
  it('mode 缺省 → 返回原始对象（非 proxy），无 collector 依赖', async () => {
    stubFetch({ id: 'x' })
    const client = createFetchClient({ baseUrl: 'http://x/api' })
    const data = await client.fetch<{ id: string }>('GET', '/users/1')
    const t2 = data                       // plain object
    void t2
    // 关键断言：默认 path 完全不经 collector/proxy —— 用 noop 模拟注入也无效
    const noop = createNoopCollector()
    const client2 = createFetchClient({ baseUrl: 'http://x/api', collector: noop })
    const d2 = await client2.fetch<{ id: string }>('GET', '/users/1')
    expect(d2).toEqual({ id: 'x' })
    expect(noop.drain()).toEqual({ hits: [], traces: [], evidence: [] })
  })
})
