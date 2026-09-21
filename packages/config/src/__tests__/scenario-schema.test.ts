/**
 * config scenarios 段（spec §10 原文口径）：include/concurrency 解析 + 上限门 + 缺省可缺席。
 */
import { describe, it, expect } from 'vitest'
import { ConfigSchema, ScenarioConfigSchema } from '../schema'

describe('ScenarioConfigSchema', () => {
  it('include + concurrency 解析；concurrency 0/11 拒绝', () => {
    expect(ScenarioConfigSchema.parse({ include: ['mk/scenarios/**/*.yml'], concurrency: 3 })).toEqual({
      include: ['mk/scenarios/**/*.yml'],
      concurrency: 3,
    })
    expect(() => ScenarioConfigSchema.parse({ include: ['x'], concurrency: 0 })).toThrow()
    expect(() => ScenarioConfigSchema.parse({ include: ['x'], concurrency: 11 })).toThrow()
  })

  it('ConfigSchema.scenarios 可缺席（向后兼容）→ 提供时透传', () => {
    expect(ConfigSchema.parse({}).scenarios).toBeUndefined()
    const parsed = ConfigSchema.parse({ scenarios: { include: ['a.yml'] } })
    expect(parsed.scenarios).toEqual({ include: ['a.yml'] })
  })
})
