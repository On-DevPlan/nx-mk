/**
 * assertNever 工具测试 (M5)
 *
 * 验证：
 * - assertNever 抛出错误（编译期+运行期）
 * - 编译期：未处理 union 变体会触发 TS 编译错误（已在 ci 验证）
 */
import { describe, it, expect } from 'vitest'
import { assertNever } from '../types'

describe('M5: assertNever', () => {
  it('throws Error when called with unhandled value', () => {
    expect(() => assertNever('unexpected' as never)).toThrow(
      'Unhandled discriminant: "unexpected"',
    )
  })

  it('throws Error with structured info for object values', () => {
    const value = { kind: 'mystery' } as never
    expect(() => assertNever(value)).toThrow(/Unhandled discriminant/)
  })

  it('throws Error containing the value for debugging', () => {
    try {
      assertNever(42 as never)
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain('42')
    }
  })
})