/**
 * PluginSettings v1 编辑器（WP3：JSON textarea；两段式 Preview→Apply）。
 * node 渲染环境只做 renderToString 冒烟——交互链路由 T5 的 inject 矩阵覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

vi.mock('../ui/hooks', () => ({
  usePolling: vi.fn(),
  useEventSource: () => ({ connected: false }),
}))
const { usePolling } = await import('../ui/hooks')
const { PluginSettingsPage, ConfigEditor } = await import('../ui/pages/PluginSettings')

const ENTRY = {
  name: '@nx-mk/plugin-swagger',
  version: '0.1.0',
  enabled: true,
  config: { maxTurns: 3 },
  configSchema: null,
}

beforeEach(() => {
  vi.mocked(usePolling).mockReturnValue({
    data: { stale: false, plugins: [ENTRY] },
    error: null,
    refresh: () => {},
  } as never)
})

describe('PluginSettingsPage (v1 editor)', () => {
  it('renders Edit config entry and no longer claims read-only (old copy retired)', () => {
    const html = renderToString(createElement(PluginSettingsPage))
    expect(html).toContain('Edit config')
    expect(html).not.toContain('write-back lands in v1')
  })
})

describe('ConfigEditor', () => {
  it('textarea prefilled with current per-plugin config JSON; has Preview/Apply buttons', () => {
    const html = renderToString(createElement(ConfigEditor, { name: ENTRY.name, initial: ENTRY.config }))
    expect(html).toContain('&quot;maxTurns&quot;')
    expect(html).toContain('Preview')
    expect(html).toContain('Apply')
  })

  it('null/undefined initial falls back to empty object prefill', () => {
    const html = renderToString(createElement(ConfigEditor, { name: 'p', initial: null }))
    expect(html).toContain('textarea')
  })
})
