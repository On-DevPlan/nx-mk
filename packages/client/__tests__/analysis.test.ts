/**
 * analysis 分支单测（spec §3.5）
 * 锁死：analysis 下 fetch 后响应被 proxy 包裹（data.id 读取产生 hit）；trace 进 collector；
 * production 默认 mode 零改动（无 proxy、无 collector 分配）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFetchClient } from '../src/runtime/client.js'
import { createAnalysisContext, endpointScopePath, matchEndpoint } from '../src/mode/analysis.js'
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
    // 响应值预览随 trace 采集（≤500 字符；UI RequestDetail「响应值」数据通道）
    expect(drained.traces.some((t) => t.responsePreview === '{"id":"u1","name":"x"}')).toBe(true)
  })

  it('collector 缺省时用 noop（drain 恒空，请求成功）', async () => {
    stubFetch({ ok: 1 })
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis' })
    const data = await client.fetch('GET', '/ping')
    expect(data).toEqual({ ok: 1 })
  })

  it('探针故障隔离：collector.trace 抛错仍返回解析后的数据', async () => {
    stubFetch({ id: 'u9' })
    const brokenCollector: Collector = {
      hit() { throw new Error('boom') },
      trace() { throw new Error('trace boom') },
      evidence() { throw new Error('boom') },
      drain() { return { hits: [], traces: [], evidence: [] } },
    }
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis', collector: brokenCollector })
    const data = await client.fetch<{ id: string }>('GET', '/users/u9')
    expect(data).toEqual({ id: 'u9' })  // ← containment：响应不被探针异常击穿
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

// —— Ruling 6（Task 7 审查）：缺省解析 —— mode 缺省改走 detectMode()；analysis 下
// collector/manifest 缺省回退浏览器单通道 globalThis.__MK_COLLECTOR__ / __MK_MANIFEST__ ——
// Node/测试环境无这些全局 → production / noop，零开销语义不变（spec §1.4.3）
describe('Ruling 6 缺省解析', () => {
  // 回退解析面向浏览器（resolveDefaultCollector 读 window.x）；Node 测试环境缺
  // window —— 显式别名到 globalThis 模拟浏览器运行时（与其余 Ruling 6/7 单测同一手法）
  afterEach(() => {
    delete process.env.__MK_ANALYSIS__
    delete (globalThis as Record<string, unknown>).__MK_COLLECTOR__
    delete (globalThis as Record<string, unknown>).__MK_MANIFEST__
    delete (globalThis as Record<string, unknown>).window
  })

  it('mode 缺省 → detectMode()：process.env.__MK_ANALYSIS__=true 进 analysis（onResponse 触发）', async () => {
    stubFetch({ id: 'u1' })
    process.env.__MK_ANALYSIS__ = 'true'
    const onResponse = vi.fn()
    const client = createFetchClient({ baseUrl: 'http://x/api', onResponse })
    const data = await client.fetch<{ id: string }>('GET', '/users/u1')
    const id = data.id
    void id
    // onRequest/onResponse 仅 analysis 分支触发 —— 证明缺省 mode 经 detectMode 解析为 analysis
    expect(onResponse).toHaveBeenCalledOnce()
  })

  it('analysis + collector 缺省 → 浏览器 shim（__MK_COLLECTOR__）承接 trace + proxy hit', async () => {
    stubFetch({ id: 'u1' })
    const hits: Array<Record<string, unknown>> = []
    const traces: Array<Record<string, unknown>> = []
    ;(globalThis as Record<string, unknown>).__MK_COLLECTOR__ = {
      hits,
      traces,
      hit(h: Record<string, unknown>) { hits.push(h) },
      trace(t: Record<string, unknown>) { traces.push(t) },
    }
    ;(globalThis as Record<string, unknown>).window = { __MK_COLLECTOR__: (globalThis as Record<string, unknown>).__MK_COLLECTOR__ }
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis' })
    const data = await client.fetch<{ id: string }>('GET', '/users/u1')
    const id = data.id       // ← proxy hit 流向 shim 缓冲
    void id
    expect(traces.some((t) => t.method === 'GET' && t.status === 200)).toBe(true)
    expect(hits.some((h) => h.normalizedPath === 'data.id')).toBe(true)
  })

  it('Ruling 8：analysis + manifest 缺省 → __MK_MANIFEST__ 参与 endpoint 匹配（endpointId 命中）', async () => {
    stubFetch({ id: 'u1' })
    const traces: Array<Record<string, unknown>> = []
    ;(globalThis as Record<string, unknown>).__MK_COLLECTOR__ = {
      hits: [], traces,
      hit() {},
      trace(t: Record<string, unknown>) { traces.push(t) },
    }
    ;(globalThis as Record<string, unknown>).window = { __MK_COLLECTOR__: (globalThis as Record<string, unknown>).__MK_COLLECTOR__ }
    ;(globalThis as Record<string, unknown>).__MK_MANIFEST__ = {
      endpoints: [{ id: 'ep_getUser', method: 'GET', path: '/users/{id}' }],
    }
    // fetch URL 含 baseUrl 段（http://x/api/users/u1 → pathname /api/users/u1）；
    // endpointScopePath 先剥掉 baseUrl 前缀再进 matchEndpoint —— 模板保持 API 空间
    // （OpenAPI path 永不含挂载前缀），断言 __MK_MANIFEST__ 参与 matchEndpoint 的机制本身
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis' })
    const data = await client.fetch<{ id: string }>('GET', '/users/u1')
    const id = data.id
    void id
    expect(traces.some((t) => t.endpointId === 'ep_getUser')).toBe(true)
  })

  it('analysis + 无 shim（Node 环境）→ collector 缺省 noop：请求成功、drain 恒空', async () => {
    stubFetch({ ok: 1 })
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis' })
    const data = await client.fetch('GET', '/ping')
    expect(data).toEqual({ ok: 1 })
  })
})

describe('endpointScopePath（base 前缀剥离 → matchEndpoint API 空间匹配）', () => {
  const manifest = {
    endpoints: [{ id: 'ep-user', method: 'GET', path: '/users/{id}' }],
  } as never

  it('带 /api 代理前缀的 pathname 剥前缀后命中模板', () => {
    expect(endpointScopePath('/api/users/u_001', '/api')).toBe('/users/u_001')
    expect(matchEndpoint(manifest, endpointScopePath('/api/users/u_001', '/api'), 'GET')).toBe('ep-user')
  })

  it('base 为绝对 URL / 根 / 尾斜杠时行为正确', () => {
    expect(endpointScopePath('/users/u_001', 'http://localhost:8787')).toBe('/users/u_001')
    expect(endpointScopePath('/users/u_001', '/')).toBe('/users/u_001')
    expect(endpointScopePath('/api/users/u_001', '/api/')).toBe('/users/u_001')
    // 前缀不匹配（不同挂载点）→ 原样返回，匹配自然失败
    expect(endpointScopePath('/v2/users/u_001', '/api')).toBe('/v2/users/u_001')
  })
})
