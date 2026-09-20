/**
 * plugins 联合类型（spec W1/W3）：裸 string 向后兼容 + { name, config } per-plugin 命名空间。
 */
import { describe, it, expect } from 'vitest'
import { ConfigSchema, PluginEntrySchema, normalizePluginEntries } from '../schema'

describe('ConfigSchema.plugins 联合类型', () => {
  it('裸 string 数组照常解析（向后兼容，现存 config 零破坏）', () => {
    const parsed = ConfigSchema.parse({ plugins: ['@nx-mk/plugin-swagger'] })
    expect(parsed.plugins).toEqual(['@nx-mk/plugin-swagger'])
  })

  it('对象条目解析出 { name, config }', () => {
    const parsed = ConfigSchema.parse({
      plugins: [{ name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } }],
    })
    expect(parsed.plugins).toEqual([{ name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } }])
  })

  it('对象条目缺 config → default {}', () => {
    const parsed = PluginEntrySchema.parse({ name: '@nx-mk/plugin-swagger' })
    expect(parsed).toEqual({ name: '@nx-mk/plugin-swagger', config: {} })
  })

  it('混合列表（string + 对象）可解析', () => {
    const parsed = ConfigSchema.parse({
      plugins: ['@nx-mk/plugin-playwright', { name: '@nx-mk/plugin-swagger', config: {} }],
    })
    expect(parsed.plugins).toHaveLength(2)
  })

  it('非法插件名（含空格）在对象条目内同样拒绝', () => {
    expect(() => PluginEntrySchema.parse({ name: 'BAD NAME WITH SPACES', config: {} })).toThrow()
  })

  it('非 string 非对象的条目拒绝', () => {
    expect(() => PluginEntrySchema.parse(42)).toThrow()
  })

  it('max 20 上限仍生效', () => {
    const twentyOne = Array.from({ length: 21 }, () => '@nx-mk/plugin-swagger')
    expect(() => ConfigSchema.parse({ plugins: twentyOne })).toThrow(/max 20 plugins/)
  })
})

describe('normalizePluginEntries（W3）', () => {
  it('裸 string → { name, config: {} }；对象原样透传', () => {
    expect(
      normalizePluginEntries([
        '@nx-mk/plugin-playwright',
        { name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } },
      ]),
    ).toEqual([
      { name: '@nx-mk/plugin-playwright', config: {} },
      { name: '@nx-mk/plugin-swagger', config: { maxTurns: 7 } },
    ])
  })

  it('空数组 → 空输出', () => {
    expect(normalizePluginEntries([])).toEqual([])
  })
})
