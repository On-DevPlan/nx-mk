/**
 * C2（§10 对齐）：coverage 段条目 schema —— string | {pattern, reason} 联合，
 * 纯字符串向后兼容（Phase 3 既有配置不受影响）。
 */
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../schema.js'

describe('coverage 段条目 schema（C2）', () => {
  it('纯字符串条目（向后兼容）通过', () => {
    const cfg = ConfigSchema.parse({ coverage: { required: ['data.name'], ignored: ['**.metadata.**'] } })
    expect(cfg.coverage?.required).toEqual(['data.name'])
    expect(cfg.coverage?.ignored).toEqual(['**.metadata.**'])
  })

  it('对象条目 {pattern, reason} 通过', () => {
    const cfg = ConfigSchema.parse({
      coverage: {
        required: [{ pattern: 'user.name', reason: '用户主标识，必须展示' }],
        optional: [{ pattern: 'user.lastLoginAt', reason: '辅助信息' }],
        ignored: [{ pattern: '*.metadata.*', reason: '元数据默认忽略' }],
      },
    })
    expect(cfg.coverage?.required?.[0]).toEqual({ pattern: 'user.name', reason: '用户主标识，必须展示' })
    expect(cfg.coverage?.optional).toHaveLength(1)
    expect(cfg.coverage?.ignored?.[0]).toEqual({ pattern: '*.metadata.*', reason: '元数据默认忽略' })
  })

  it('string 与对象条目混排通过', () => {
    const cfg = ConfigSchema.parse({
      coverage: { ignored: ['data.debugTraceId', { pattern: 'data.internalRiskScore', reason: '内部风控字段' }] },
    })
    expect(cfg.coverage?.ignored).toHaveLength(2)
  })

  it('非法条目拒绝：对象缺 pattern / reason 非字符串 / pattern 空串', () => {
    expect(() => ConfigSchema.parse({ coverage: { required: [{ reason: '无 pattern' }] } })).toThrow()
    expect(() => ConfigSchema.parse({ coverage: { required: [{ pattern: 'x', reason: 1 }] } })).toThrow()
    expect(() => ConfigSchema.parse({ coverage: { required: [{ pattern: '', reason: '空' }] } })).toThrow()
    expect(() => ConfigSchema.parse({ coverage: { required: [42] } })).toThrow()
  })
})
