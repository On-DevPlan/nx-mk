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

  it('endpoint-called 只由 trace 产出：hit-only 不再兜底 bare 报告', () => {
    // 只 hit 无 trace → 0 个 endpoint-called（bare 兜底已删除 —— 无 method/path 的报告会被伪造成 'GET (unknown)'）
    const c1 = createCollector()
    c1.hit(HIT('id'))
    const s1 = c1.snapshot(1)
    expect(s1).toEqual([expect.objectContaining({ kind: 'field-hit', fieldId: 'data.id', count: 1, turn: 1 })])
    // trace 到来 → snapshot 产出恰 1 条带 method/path 的 endpoint-called；重复 snapshot 幂等
    c1.trace({ requestId: 'r1', endpointId: 'ep1', method: 'GET', url: 'http://x/api/users/u_001', path: '/users/u_001' })
    const s2 = c1.snapshot(2)
    expect(s2).toEqual([
      expect.objectContaining({ kind: 'endpoint-called', method: 'GET', path: '/users/u_001', turn: 2 }),
    ])
    expect(c1.snapshot(3).filter((r) => r.kind === 'endpoint-called')).toHaveLength(0)
    // hit + trace 同时存在 → 仅 trace 侧一份
    const c2 = createCollector()
    c2.hit(HIT('id'))
    c2.trace({ requestId: 'r1', endpointId: 'ep1', method: 'GET', url: '/api/users' })
    expect(c2.snapshot(1)).toEqual([
      expect.objectContaining({ kind: 'field-hit', fieldId: 'data.id', count: 1, turn: 1 }),
      expect.objectContaining({ kind: 'endpoint-called', method: 'GET', path: '/api/users', turn: 1 }),
    ])
  })

  it('snapshot 幂等：已报的增量不重复（hit count 变化后重报新 count）', () => {
    const c = createCollector()
    c.hit(HIT('id'))
    expect(c.snapshot(1)).toHaveLength(1)   // 仅 field-hit（endpoint-called 需 trace）
    // 无新数据 → 空增量
    expect(c.snapshot(2)).toHaveLength(0)
    // count 增长 → 重报（count 更新）
    c.hit(HIT('id'))
    const s3 = c.snapshot(3)
    expect(s3).toEqual([expect.objectContaining({ kind: 'field-hit', count: 2, turn: 3 })])
  })

  it('evidence 带 textSample 时 drain 原样透传', () => {
    const c = createCollector()
    c.evidence({ fieldPath: 'data.address.city', evidenceType: 'text', visible: true, inViewport: true, textSample: 'HZ' })
    expect(c.drain().evidence[0]!.textSample).toBe('HZ')
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
