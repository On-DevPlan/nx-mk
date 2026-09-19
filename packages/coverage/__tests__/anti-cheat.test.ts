/** §29.1 四态 v0 三类机检（spec §3.4）：hidden→suspicious；空/字段名→weak；其余→valid；invalid 不产 */
import { describe, it, expect } from 'vitest'
import { classifyEvidence } from '../src/anti-cheat/index.js'

describe('classifyEvidence', () => {
  it('visible=false → suspicious（hidden DOM 覆盖）', () => {
    expect(classifyEvidence({ visible: false, textSample: 'secret', fieldPath: 'data.token' })).toBe('suspicious')
  })
  it('textSample 空串 → weak（只标记不展示）', () => {
    expect(classifyEvidence({ visible: true, textSample: '', fieldPath: 'data.name' })).toBe('weak')
  })
  it('textSample 缺省 → weak？否 —— 缺省按 valid（向后兼容，spec §4）', () => {
    expect(classifyEvidence({ visible: true, fieldPath: 'data.name' })).toBe('valid')
  })
  it('textSample === 字段路径末段 → weak（占位文本）', () => {
    expect(classifyEvidence({ visible: true, textSample: 'name', fieldPath: 'data.user.name' })).toBe('weak')
  })
  it('visible 且有真实文本 → valid', () => {
    expect(classifyEvidence({ visible: true, textSample: 'Alice', fieldPath: 'data.user.name' })).toBe('valid')
  })
  it('textSample 首尾空白修剪后判定', () => {
    expect(classifyEvidence({ visible: true, textSample: '  ', fieldPath: 'data.name' })).toBe('weak')
  })
})

describe('classifyEvidence — B3 noise guard（hygiene）', () => {
  // v0 锁定（原终审 T9 'startsWith 弱判别' 的兜底断言）：
  // 字段 id 末段为 Promise/Object 原型方法名（与 METHOD_NAME_BLOCKLIST 同名的集合，仅语义说明——
  // classifier 是纯等值比对，不依赖 blocklist）时，占位文本判定仍以「样本 === 末段全等」为准：
  const PROTO_NAMES = ['then', 'catch', 'finally', 'toJSON', 'valueOf', 'toString', 'constructor'] as const

  it('末段为原型方法名且样本与前缀变体不同 → valid（不产 phantom weak）', () => {
    for (const name of PROTO_NAMES) {
      expect(classifyEvidence({ visible: true, textSample: `${name}X`, fieldPath: `data.${name}` })).toBe('valid')
    }
  })

  it('末段为原型方法名且样本全等 → weak（占位判定对原型名同样生效）', () => {
    for (const name of PROTO_NAMES) {
      expect(classifyEvidence({ visible: true, textSample: name, fieldPath: `data.${name}` })).toBe('weak')
    }
  })

  it('嵌套路径取末段比对（data.depth.then 全等 → weak；近似值 → valid）', () => {
    expect(classifyEvidence({ visible: true, textSample: 'then', fieldPath: 'data.depth.then' })).toBe('weak')
    expect(classifyEvidence({ visible: true, textSample: 'thenx', fieldPath: 'data.depth.then' })).toBe('valid')
  })
})
