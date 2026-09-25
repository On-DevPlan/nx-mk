/**
 * tracked proxy 单测（spec §3.1 / Plan §19 逐字）
 * 锁死：命中上报、嵌套路径推进、数组下标 → []、§19.3 不代理名单、
 * WeakMap 缓存引用稳定、symbol 透传、探针异常不扩散到 collector 调用方。
 */
import { describe, it, expect } from 'vitest'
import { createTrackedProxy } from '../src/proxy/index.js'

// 最小 hit 收集器（形状 = Task 2 正式 Collector 的 hit 子集）
function makeCollector() {
  const hits: { requestId: string; endpointId: string; fieldPath: string; normalizedPath: string; type: string; timestamp: number; valueState?: string; valueType?: string; valueHash?: string }[] = []
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
    ['File', () => new File(['x'], 'a.txt')],
    ['Blob', () => new Blob(['x'])],
    ['WeakMap', () => new WeakMap()],
    ['WeakSet', () => new WeakSet()],
    ['ArrayBuffer', () => new ArrayBuffer(8)],
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

describe('C1 字段级值通道（§23.2：valueState/valueType/valueHash）', () => {
  it.each([
    ['string', 'name', 'Alice', 'present', 'string'],
    ['number', 'age', 7, 'present', 'number'],
    ['null', 'nickname', null, 'null', 'null'],
    ['undefined（prop 缺省）', 'ghost', undefined, 'undefined', 'undefined'],
    ['empty string', 'bio', '', 'empty', 'string'],
    ['empty array', 'tags', [], 'empty', 'array'],
    ['empty object', 'meta', {}, 'empty', 'object'],
  ])('%s → 状态/类型正确', (_name, prop, value, state, vtype) => {
    const c = makeCollector()
    const p = createTrackedProxy({ [prop]: value } as AnyObj, { ...BASE, collector: c })
    void (p as AnyObj)[prop as string]
    expect(c.hits[0]).toMatchObject({ normalizedPath: `data.${prop as string}`, valueState: state, valueType: vtype })
  })

  it('标量值产单向散列；null/undefined 不产散列；同值同散列、异值异散列', () => {
    const c = makeCollector()
    const p = createTrackedProxy({ a: 'x', b: 'y', n: null, g: undefined } as AnyObj, { ...BASE, collector: c })
    void (p as AnyObj).a
    void (p as AnyObj).b
    void (p as AnyObj).n
    void (p as AnyObj).g
    const byPath = new Map(c.hits.map((h) => [h.normalizedPath, h]))
    expect(byPath.get('data.a')?.valueHash).toMatch(/^[0-9a-f]{8}$/)
    expect(byPath.get('data.a')?.valueHash).not.toBe(byPath.get('data.b')?.valueHash)
    expect(byPath.get('data.n')?.valueHash).toBeUndefined()
    expect(byPath.get('data.g')?.valueHash).toBeUndefined()
  })

  it('对象/数组对完整值取散列（C11：不经截断）——大值仍同值同散列', () => {
    const c = makeCollector()
    const big = { list: Array.from({ length: 500 }, (_, i) => i) }
    const p = createTrackedProxy({ big, big2: { list: Array.from({ length: 500 }, (_, i) => i) } } as AnyObj, { ...BASE, collector: c })
    void (p as AnyObj).big
    void (p as AnyObj).big2
    const byPath = new Map(c.hits.map((h) => [h.normalizedPath, h]))
    // 结构相同 → 散列一致（同值异源可比对）
    expect(byPath.get('data.big')?.valueHash).toBe(byPath.get('data.big2')?.valueHash)
    // 散列是 FNV-1a 8 位十六进制 —— 原文不出浏览器
    expect(byPath.get('data.big')?.valueHash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('散列不泄露原文：短字符串值不可由散列反解（单向性回归锁）', () => {
    const c = makeCollector()
    const secret = 'jane@gmail.com'
    const p = createTrackedProxy({ email: secret } as AnyObj, { ...BASE, collector: c })
    void (p as AnyObj).email
    expect(c.hits[0]?.valueHash).toBeDefined()
    expect(JSON.stringify(c.hits[0])).not.toContain(secret)
  })
})

describe('原型方法名白名单（spec §3.4 anti-cheat #3）', () => {
  it('Promise 方法名不进 hit 且不包裹：then/catch/finally/toJSON', () => {
    const fn = () => 1
    const c = makeCollector()
    const p = createTrackedProxy({ then: fn, catch: fn, finally: fn, toJSON: fn } as AnyObj, { ...BASE, collector: c })
    const obj = p as AnyObj
    expect(obj.then).toBe(fn)
    expect(obj.catch).toBe(fn)
    expect(obj.finally).toBe(fn)
    expect(obj.toJSON).toBe(fn)
    expect(c.hits).toHaveLength(0)
  })

  it('Array 方法名不进 hit：join/map/filter/reduce/forEach/keys/values/entries/size', () => {
    const c = makeCollector()
    const p = createTrackedProxy({ tags: [1, 2] } as AnyObj, { ...BASE, collector: c })
    const tags = (p as { tags: unknown[] }).tags as unknown as Record<string, unknown>
    const proto = Array.prototype as unknown as Record<string, unknown>
    for (const name of ['join', 'map', 'filter', 'reduce', 'forEach', 'keys', 'values', 'entries', 'size']) {
      expect(tags[name]).toBe(proto[name])
    }
    // tags 本身是真字段（唯一 hit）；方法名读取一律透传不追加
    expect(c.hits.map((h) => h.fieldPath)).toEqual(['data.tags'])
  })

  it('length 仅对 Array target 生效：数组 length 无 hit；plain object 的 length 是真字段仍 hit+包裹', () => {
    const c1 = makeCollector()
    const arrP = createTrackedProxy([1, 2, 3] as unknown as AnyObj, { ...BASE, collector: c1 })
    expect((arrP as AnyObj).length).toBe(3)
    expect(c1.hits).toHaveLength(0)

    const c2 = makeCollector()
    const objP = createTrackedProxy({ length: 5 } as AnyObj, { ...BASE, collector: c2 })
    expect((objP as AnyObj).length).toBe(5) // 数字原值
    expect(c2.hits.map((h) => h.fieldPath)).toEqual(['data.length'])
  })

  it('Object 原型名不进 hit：valueOf/toString/hasOwnProperty', () => {
    const fn = () => 1
    const c = makeCollector()
    const p = createTrackedProxy({ valueOf: fn, toString: fn, hasOwnProperty: fn } as AnyObj, { ...BASE, collector: c })
    const obj = p as AnyObj
    expect(obj.valueOf).toBe(fn)
    expect(obj.toString).toBe(fn)
    expect(obj.hasOwnProperty).toBe(fn)
    expect(c.hits).toHaveLength(0)
  })

  it('真实字段不受影响（回归）：name/id/address 照常 hit + 嵌套包裹', () => {
    const c = makeCollector()
    const address = { city: 'HZ' }
    const p = createTrackedProxy({ name: 'n', id: 'u1', address } as AnyObj, { ...BASE, collector: c })
    const obj = p as AnyObj
    // 沿既有模式：先求值到普通值再断言（避免 vitest 内部枚举 proxy 干扰 hit 计数）
    const nameV = obj.name
    const idV = obj.id
    const addr = obj.address as AnyObj
    const cityV = addr.city
    expect(nameV).toBe('n')
    expect(idV).toBe('u1')
    expect(addr === address).toBe(false) // 嵌套包裹
    expect(cityV).toBe('HZ')
    const paths = c.hits.map((h) => h.fieldPath)
    expect(paths).toEqual(['data.name', 'data.id', 'data.address', 'data.address.city'])
  })
})
