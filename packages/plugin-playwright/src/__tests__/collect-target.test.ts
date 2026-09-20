/**
 * resolveCollectTarget（W1d）：plugins 列表里本插件条目的 config 优先，回落顶层 collect: 段，
 * 再回落工厂 opts（CLI 装配注入）。
 */
import { describe, it, expect } from 'vitest'
import { resolveCollectTarget } from '../index'

describe('resolveCollectTarget', () => {
  it('对象条目 config 优先于顶层 collect 与 fallback', () => {
    expect(
      resolveCollectTarget(
        {
          collect: { url: 'http://from-collect' },
          plugins: [{ name: '@nx-mk/plugin-playwright', config: { url: 'http://from-entry' } }],
        },
        { url: 'http://from-opts' },
      ),
    ).toEqual({ url: 'http://from-entry', waitForSelector: undefined })
  })

  it('条目缺 url → 回落顶层 collect.url', () => {
    expect(
      resolveCollectTarget(
        {
          collect: { url: 'http://from-collect', waitForSelector: '[data-x]' },
          plugins: [{ name: '@nx-mk/plugin-playwright', config: {} }],
        },
        {},
      ),
    ).toEqual({ url: 'http://from-collect', waitForSelector: '[data-x]' })
  })

  it('裸 string 条目/无条目 → 仅顶层 collect 与 fallback', () => {
    expect(
      resolveCollectTarget({ collect: { url: 'http://c' }, plugins: ['other-pkg'] }, { url: 'http://o' }),
    ).toEqual({ url: 'http://c', waitForSelector: undefined })
    expect(resolveCollectTarget({ plugins: [] }, { waitForSelector: '[data-mk-field]' })).toEqual({
      url: undefined,
      waitForSelector: '[data-mk-field]',
    })
  })
})
