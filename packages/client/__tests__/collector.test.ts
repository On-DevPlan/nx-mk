/**
 * collector 单测（spec §3.2）：hit 按 normalizedPath 聚合、drain 清空、
 * snapshot 增量幂等、noop 全 no-op。
 */
import { describe, it, expect } from 'vitest'
import { createCollector, createNoopCollector } from '../src/collector/index.js'

const HIT = (path: string, ts = Date.now()) => ({
  requestId: 'r1', endpointId: 'ep1',
  fieldPath: `data.${path}`, normalizedPath: `data.${path}`,
  type: 'get' as const, timestamp: ts,
})

describe('createCollector', () => {
  it('hit 按 normalizedPath 聚合 count', () => {
    const c = createCollector()
    c.hit(HIT('id')); c.hit(HIT('id')); c.hit(HIT('name'))
    const { hits } = c.drain()
    expect(hits).toHaveLength(2)
    expect(hits.find((h) => h.normalizedPath === 'data.id')!.count).toBe(2)
    expect(hits.find((h) => h.normalizedPath === 'data.name')!.count).toBe(1)
  })

  it('drain 返回并清空', () => {
    const c = createCollector()
    c.hit(HIT('id'))
    c.trace({ requestId: 'r1', method: 'GET', url: '/api/users' })
    c.evidence({ fieldPath: 'data.id', evidenceType: 'text', visible: true, inViewport: true })
    expect(c.drain()).toEqual({
      hits: [expect.objectContaining({ normalizedPath: 'data.id', count: 1 })],
      traces: [expect.objectContaining({ method: 'GET' })],
      evidence: [expect.objectContaining({ evidenceType: 'text' })],
    })
    expect(c.drain()).toEqual({ hits: [], traces: [], evidence: [] })
  })

  it('reset 清空全部', () => {
    const c = createCollector()
    c.hit(HIT('id')); c.reset()
    expect(c.drain().hits).toHaveLength(0)
  })

  it('snapshot 产出 field-hit + endpoint-called 增量，且 drain 不受影响', () => {
    const c = createCollector()
    c.hit(HIT('id'))
    c.trace({ requestId: 'r1', method: 'GET', url: 'http://x/api/users/u_001', path: '/users/u_001' })
    const s1 = c.snapshot(2)
    expect(s1).toHaveLength(2)  // 严格断言：1 field-hit + 1 endpoint-called，无重复
    expect(s1).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'field-hit', fieldId: 'data.id', count: 1, turn: 2 }),
      expect.objectContaining({ kind: 'endpoint-called', method: 'GET', path: '/users/u_001', turn: 2 }),
    ]))
    expect(c.drain().hits).toHaveLength(1)  // snapshot 不消费
  })

  it('同一 endpointId 不会在单个 snapshot 中重复报 endpoint-called', () => {
    // 只 hit 无 trace → 恰好 1 个 bare endpoint-called
    const c1 = createCollector()
    c1.hit(HIT('id'))
    const s1 = c1.snapshot(1)
    expect(s1.filter((r) => r.kind === 'endpoint-called')).toHaveLength(1)
    expect(s1.filter((r) => r.kind === 'endpoint-called')[0]).toEqual(
      expect.objectContaining({ kind: 'endpoint-called' }),
    )
    // trace 到来 → 下一次 snapshot 重报带 method/path 的 endpoint-called，但不重复
    c1.trace({ requestId: 'r1', endpointId: 'ep1', method: 'GET', url: 'http://x/api/users/u_001', path: '/users/u_001' })
    const s2 = c1.snapshot(2)
    expect(s2.filter((r) => r.kind === 'endpoint-called')).toHaveLength(1)
    expect(s2.filter((r) => r.kind === 'endpoint-called')[0]).toEqual(
      expect.objectContaining({ method: 'GET', path: '/users/u_001' }),
    )
    // hit + trace 同时存在 → 仅 trace 侧一份
    const c2 = createCollector()
    c2.hit(HIT('id'))
    c2.trace({ requestId: 'r1', endpointId: 'ep1', method: 'GET', url: '/api/users' })
    expect(c2.snapshot(1).filter((r) => r.kind === 'endpoint-called')).toHaveLength(1)
  })

  it('snapshot 幂等：已报的增量不重复（hit count 变化后重报新 count）', () => {
    const c = createCollector()
    c.hit(HIT('id'))
    expect(c.snapshot(1)).toHaveLength(2)   // field-hit + 无 trace
    // 无新数据 → 空增量
    expect(c.snapshot(2)).toHaveLength(0)
    // count 增长 → 重报（count 更新）
    c.hit(HIT('id'))
    const s3 = c.snapshot(3)
    expect(s3).toEqual([expect.objectContaining({ kind: 'field-hit', count: 2, turn: 3 })])
  })
})

describe('createNoopCollector', () => {
  it('全部 no-op，drain 恒空', () => {
    const c = createNoopCollector()
    c.hit(HIT('id'))
    c.trace({ requestId: 'r', method: 'GET', url: '/' })
    c.evidence({ fieldPath: 'x', evidenceType: 'text', visible: true, inViewport: true })
    expect(c.snapshot(1)).toEqual([])
    expect(c.drain()).toEqual({ hits: [], traces: [], evidence: [] })
  })
})
