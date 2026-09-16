/**
 * dom scanner 纯函数（spec §3.4 / §6）：元素描述数组 → evidence 结构（过滤 + 组装 + selector 生成）
 */
import { describe, it, expect } from 'vitest'
import { scanDom } from '../src/evidence/dom-scanner.js'

describe('scanDom', () => {
  it('元素描述组装为 evidence（text 类型）', () => {
    expect(scanDom([
      { dataMkField: 'data.id', visible: true, inViewport: true },
      { dataMkField: 'data.address.zip', visible: false, inViewport: false },
    ])).toEqual([
      { fieldPath: 'data.id', evidenceType: 'text', visible: true, inViewport: true, selector: '[data-mk-field="data.id"]', requestId: undefined, fieldId: undefined, route: undefined },
      { fieldPath: 'data.address.zip', evidenceType: 'text', visible: false, inViewport: false, selector: '[data-mk-field="data.address.zip"]', requestId: undefined, fieldId: undefined, route: undefined },
    ])
  })

  it('空 dataMkField 过滤；invisible 保留（hidden evidence 有价值）', () => {
    const out = scanDom([{ dataMkField: '', visible: true, inViewport: true }, { dataMkField: 'x', visible: false, inViewport: false }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ fieldPath: 'x', visible: false })
  })

  it('空数组 → 空输出', () => {
    expect(scanDom([])).toEqual([])
  })
})
