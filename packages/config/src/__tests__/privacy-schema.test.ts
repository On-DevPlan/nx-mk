/**
 * §24 privacy 段 schema 单测：三态 mode、mask 规则形状、缺省不注入。
 */
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../schema.js'

describe('privacy 段 schema（§24）', () => {
  it('缺省不注入（optional，无默认值——安全默认归 coverage 消费方）', () => {
    const cfg = ConfigSchema.parse({})
    expect(cfg.privacy).toBeUndefined()
  })

  it('合法 mode 三态 + mask 规则列表通过', () => {
    for (const mode of ['masked', 'raw', 'none'] as const) {
      const cfg = ConfigSchema.parse({
        privacy: {
          responseValues: { mode },
          mask: [{ pattern: '*.email', strategy: 'email' }, { pattern: '*.token', strategy: 'full' }],
        },
      })
      expect(cfg.privacy?.responseValues?.mode).toBe(mode)
      expect(cfg.privacy?.mask).toHaveLength(2)
    }
  })

  it('mask 规则缺省 strategy 之外取值 / mode 非法取值 → 拒绝', () => {
    expect(() =>
      ConfigSchema.parse({ privacy: { mask: [{ pattern: '*.x', strategy: 'reverse' }] } }),
    ).toThrow()
    expect(() => ConfigSchema.parse({ privacy: { responseValues: { mode: 'public' } } })).toThrow()
    expect(() => ConfigSchema.parse({ privacy: { mask: [{ pattern: '', strategy: 'full' }] } })).toThrow()
  })

  it('responseValues / mask 各自可独立缺省', () => {
    const cfg = ConfigSchema.parse({ privacy: {} })
    expect(cfg.privacy).toEqual({})
  })
})
