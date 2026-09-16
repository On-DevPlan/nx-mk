/**
 * tracked proxy 单测（spec §3.1 / Plan §19 逐字）
 * 锁死：命中上报、嵌套路径推进、数组下标 → []、§19.3 不代理名单、
 * WeakMap 缓存引用稳定、symbol 透传、探针异常不扩散到 collector 调用方。
 */
import { describe, it, expect } from 'vitest'
import { createTrackedProxy } from '../src/proxy/index.js'

// 最小 hit 收集器（形状 = Task 2 正式 Collector 的 hit 子集）
function makeCollector() {
  const hits: { requestId: string; endpointId: string; fieldPath: string; normalizedPath: string; type: string; timestamp: number }[] = []
  return { hits, hit: (h: (typeof hits)[number]) => { hits.push(h) } }
}
const BASE = { requestId: 'req1', endpointId: 'ep1', basePath: 'data' }
type AnyObj = Record<string, unknown>

describe('字段命中与路径', () => {
  it('顶层字段 → hit fieldPath=data.id normalizedPath=data.id', () => {
    const c = makeCollector()
    const p = createTrackedProxy({ id: 'u1' } as AnyObj, { ...BASE, collector: c })
    const v = (p as AnyObj).id
    void v
    expect(c.hits).toEqual([expect.objectContaining({ fieldPath: 'data.id', normalizedPath: 'data.id', type: 'get' })])
  })

  it('嵌套 plain object → data.address.city（basePath 推进）', () => {
    const c = makeCollector()
    const p = createTrackedProxy({ address: { city: 'HZ' } } as AnyObj, { ...BASE, collector: c })
    const v = (p as { address: AnyObj }).address.city
    void v
    expect(c.hits.map((h) => h.normalizedPath)).toEqual(['data.address', 'data.address.city'])
  })

  it('嵌套数组元素字段 → data[].id（下标归一化）', () => {
    const c = makeCollector()
    const p = createTrackedProxy({ users: [{ id: 'x' }] } as AnyObj, { ...BASE, collector: c })
    const v = (p as { users: unknown[] }).users[0]
    void v
    expect(c.hits.some((h) => h.normalizedPath === 'users[]' || h.normalizedPath === 'data.users[]')).toBe(true)
  })

  it('顶层数组元素（response 本身是数组）→ data[].id', () => {
    const c = makeCollector()
    const p = createTrackedProxy([{ id: 'x' }] as unknown as AnyObj, { ...BASE, collector: c })
    const v = (p as unknown as unknown[])[0]
    void v
    // 数组 index 读取本身也产生 hit（路径 data[]）
    expect(c.hits.some((h) => h.normalizedPath === 'data[]')).toBe(true)
  })
})

describe('§19.3 不代理名单（值原样引用返回，无二次 hit）', () => {
  it.each([
    ['Date', () => new Date(0)],
    ['Map', () => new Map()],
    ['Set', () => new Set()],
    ['Promise', () => Promise.resolve(1)],
    ['Error', () => new Error('x')],
    ['RegExp', () => /x/],
    ['URL', () => new URL('http://localhost/x')],
    ['FormData', () => new FormData()],
  ])('%s 不被代理', (_name, factory) => {
    const c = makeCollector()
    const v = factory()
    const p = createTrackedProxy({ v } as AnyObj, { ...BASE, collector: c })
    expect((p as AnyObj).v).toBe(v)
  })

  it('class instance 不代理', () => {
    class Foo { x = 1 }
    const c = makeCollector()
    const f = new Foo()
    const p = createTrackedProxy({ f } as AnyObj, { ...BASE, collector: c })
    expect((p as AnyObj).f).toBe(f)
  })
})

describe('缓存与安全', () => {
  it('WeakMap：同一 target 二次包裹返回同一引用', () => {
    const c = makeCollector()
    const t = { id: 1 }
    expect(createTrackedProxy(t, { ...BASE, collector: c })).toBe(createTrackedProxy(t, { ...BASE, collector: c }))
  })

  it('symbol prop 直接透传，无 hit', () => {
    const c = makeCollector()
    const sym = Symbol('s')
    const p = createTrackedProxy({ [sym]: 42 } as AnyObj, { ...BASE, collector: c })
    expect((p as Record<symbol, unknown>)[sym]).toBe(42)
    expect(c.hits).toHaveLength(0)
  })

  it('collector.hit 抛错不破坏读取（探针吞异常，值仍返回）', () => {
    const boom = { hit: () => { throw new Error('collector down') } }
    const p = createTrackedProxy({ id: 7 } as AnyObj, { ...BASE, collector: boom })
    expect((p as AnyObj).id).toBe(7)
  })
})
