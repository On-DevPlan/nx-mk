/**
 * 3-tab 重构（dashboard UI 优化定版）：进度/请求/插件三大 tab。
 * - router：#/progress、#/plugins 两个新 page id（旧 14 路由全保留）
 * - ProgressPage：五相时间线 + 当前报告卡片 + 场景/agent 子页链接（renderToString）
 * - PluginCenterPage：生命周期五组 × 钩点位、已装插件卡片、安装区占位（disabled）
 * node 渲染环境，无事件模拟 —— 同 c12/pages.test 模式（ Networking 用 usePolling mock）。
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { resolvePage } from '../ui/router'

describe('router: 3-tab routes', () => {
  it('#/progress → progress 页', () => {
    expect(resolvePage('/progress')).toEqual({ page: 'progress', params: {} })
  })
  it('#/plugins → plugins 页（原 /settings/plugins 保留不回归）', () => {
    expect(resolvePage('/plugins')).toEqual({ page: 'plugins', params: {} })
    expect(resolvePage('/settings/plugins')).toEqual({ page: 'settings', params: {} })
  })
})

// usePolling mock：按 url 分发 fixture
type Fixture = Record<string, unknown>
vi.mock('../ui/hooks', () => ({
  usePolling: <T,>(url: string | null): { data: T | null; error: null } => {
    const fixtures = (globalThis as { __c8Fixtures?: Fixture }).__c8Fixtures ?? {}
    return { data: (url !== null ? fixtures[url] : null) as T | null, error: null }
  },
  useEventSource: () => ({ connected: true }),
}))

const RUNS = {
  runs: [{ runId: 'run_a', hasEvents: true, hasReport: true, startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:01:00Z', terminatedBy: 'goal-met', status: 'completed' }],
  manifestAvailable: true,
}
const METRICS = {
  runId: 'run_a',
  status: 'completed',
  terminatedBy: 'goal-met',
  metrics: { requiredCoverage: 0.8, effectiveCoverage: 0.9, rawBackendFieldCoverage: 1, endpointsTotal: 5, endpointsCalled: 4, fieldsTotal: 20, fieldsReturned: 16, requiredFields: 10, missingRequiredFields: 2, ignoredReturnedFields: 1, suspiciousFields: 0 },
}
const PIPELINE = {
  runId: 'run_a',
  phases: [
    { phase: 'loadConfig', startedAt: '2026-10-01T00:00:00Z', durationMs: 5 },
    { phase: 'resolvePlugins', startedAt: '2026-10-01T00:00:01Z', durationMs: 7 },
    { phase: 'initPlugins', startedAt: '2026-10-01T00:00:02Z', durationMs: 9 },
    { phase: 'run', startedAt: '2026-10-01T00:00:03Z', durationMs: 400 },
    { phase: 'shutdown', startedAt: null, durationMs: null },
  ],
  plugins: [{ name: 'coverage-plugin', version: '1.0.0', state: 'active' }],
  turns: [{ turn: 1, ratio: 0.5, covered: 10, total: 20, progress: 'rendered field_0' }],
  goal: { status: 'unmet', ratio: 0.5, turns: 1, durationMs: 400 },
  scenarios: [],
  analysis: { summary: 'ok', detail: [] },
  manifest: null,
}
const PLUGINS = {
  plugins: [
    { name: 'coverage-plugin', version: '1.0.0', enabled: true, config: null, configSchema: null },
  ],
  stale: false,
}

const REQUESTS = {
  requests: [{ requestId: 'req_1', method: 'GET', path: '/users', status: 200, durationMs: 12 }],
}
const FIXTURES: Fixture = {
  '/api/runs': RUNS,
  '/api/runs/run_a/requests': REQUESTS,
  '/api/runs/run_a/metrics': METRICS,
  '/api/runs/run_a/pipeline': PIPELINE,
  '/api/plugins': PLUGINS,
}
;(globalThis as { __c8Fixtures?: Fixture }).__c8Fixtures = FIXTURES

function renderPage(el: ReturnType<typeof createElement>): string {
  return renderToString(el).replace(/<!-- -->/g, '')
}

describe('ProgressPage（进度 tab）', () => {
  it('渲染五相时间线（phase 名可见）+ 报告卡片（runId/覆盖率/缺失字段）+ 子页链接', async () => {
    const { ProgressPage } = await import('../ui/pages/Progress')
    const html = renderPage(createElement(ProgressPage))
    for (const phase of ['loadConfig', 'resolvePlugins', 'initPlugins', 'run', 'shutdown']) {
      expect(html).toContain(phase)
    }
    expect(html).toContain('run_a')
    expect(html).toContain('80%')
    expect(html).toContain('missing 2')
    expect(html).toContain('#/runs/run_a/pipeline')
    expect(html).toContain('#/runs/run_a/agent')
  })
  it('无 run → 空态诚实降级（不炸）', async () => {
    const fx = (globalThis as { __c8Fixtures?: Fixture }).__c8Fixtures!
    const saved = fx['/api/runs']
    fx['/api/runs'] = { runs: [], manifestAvailable: false }
    const { ProgressPage } = await import('../ui/pages/Progress')
    const html = renderPage(createElement(ProgressPage))
    expect(html).toContain('No runs yet')
    fx['/api/runs'] = saved
  })
})

describe('RequestsStats（请求 tab 统计条）', () => {
  it('DSL 驱动完成数 = endpointsCalled/total', async () => {
    const { RequestsPage } = await import('../ui/pages/Requests')
    const page = renderPage(createElement(RequestsPage, { runId: 'run_a' }))
    expect(page).toContain('4/5')
  })
})

describe('PluginCenterPage（插件 tab）', () => {
  it('生命周期五组 × 钩点位渲染；插件卡片在对应组内；安装区 disabled 占位', async () => {
    const { PluginCenterPage } = await import('../ui/pages/PluginCenter')
    const html = renderPage(createElement(PluginCenterPage))
    for (const phase of ['loadConfig', 'resolvePlugins', 'initPlugins', 'run', 'shutdown']) {
      expect(html).toContain(phase)
    }
    expect(html).toContain('coverage-plugin')
    expect(html).toContain('beforeRun')
    expect(html).toContain('afterShutdown')
    expect(html).toContain('install via npm')
    expect(html).toContain('upload zip')
  })
})
