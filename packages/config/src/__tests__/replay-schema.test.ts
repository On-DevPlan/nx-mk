/**
 * C3（§10 对齐）：replay 段 schema —— allowMethods / requireConfirmation / block 黑名单，
 * 全部 optional；整体缺省 = 内置默认行为（GET-safe / POST-confirm）。
 */
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../schema.js'

describe('replay 段 schema（C3）', () => {
  it('缺省不注入', () => {
    const cfg = ConfigSchema.parse({})
    expect(cfg.replay).toBeUndefined()
  })

  it('Plan §10 示例形状通过', () => {
    const cfg = ConfigSchema.parse({
      replay: {
        allowMethods: ['GET', 'HEAD'],
        requireConfirmation: ['POST', 'PUT', 'PATCH', 'DELETE'],
        block: [{ pattern: '/api/payment/**' }, { pattern: '/api/delete/**' }],
      },
    })
    expect(cfg.replay?.allowMethods).toEqual(['GET', 'HEAD'])
    expect(cfg.replay?.requireConfirmation).toHaveLength(4)
    expect(cfg.replay?.block?.[0]?.pattern).toBe('/api/payment/**')
  })

  it('三小节各自可独立缺省', () => {
    const cfg = ConfigSchema.parse({ replay: { allowMethods: ['GET'] } })
    expect(cfg.replay).toEqual({ allowMethods: ['GET'] })
  })

  it('非法取值拒绝：block 条目缺 pattern / pattern 空串 / allowMethods 非数组', () => {
    expect(() => ConfigSchema.parse({ replay: { block: [{}] } })).toThrow()
    expect(() => ConfigSchema.parse({ replay: { block: [{ pattern: '' }] } })).toThrow()
    expect(() => ConfigSchema.parse({ replay: { allowMethods: 'GET' } })).toThrow()
  })
})
