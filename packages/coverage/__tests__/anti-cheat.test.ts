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
