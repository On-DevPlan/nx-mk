/**
 * Phase 4.5 UI 渲染测试（node renderToString，无 jsdom）：
 * RequestDetail 含 Replay 区块 / useEventSource 无 EventSource 环境 no-op /
 * YAML 生成器类型分支归 Task 7 同文件扩展。
 *
 * Mock 工厂按 path 分发：usePolling 返回值需匹配页面真实消费的最小形状。
 * RequestDetail 消费 trace/hits/evidence；Overview 消费 runs（且 latest.runId 解析
 * 后才拉 metrics，这里 mock 让 metrics 拿 null）；T7 加 PluginSettings/ManifestBrowser
 * 时往 usePolling 分发表里加新分支即可，不要把现在的 dispatch 表清掉。
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

vi.mock('../ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/hooks')>()
  return {
    ...actual, // useEventSource 走真实现（node 无 EventSource → no-op 分支，正是要测的）
    usePolling: <T,>(path: string | null) => {
      if (path === null) {
        return { data: null as T | null, error: null, refresh: () => {} }
      }
      // RequestDetail：/api/runs/:runId/requests/:requestId
      if (path.includes('/requests/')) {
        return {
          data: {
            trace: {
              id: 't',
              runId: 'run_a',
              traceId: 'req_1',
              scenarioId: null,
              dslStepId: null,
              endpointId: null,
              method: 'GET',
              url: 'http://api.local/users/1',
              path: '/users/1',
              status: 200,
              durationMs: 12,
              startedAt: null,
              endedAt: null,
              replayable: null,
              replaySafety: null,
              replayReason: null,
            },
            hits: [],
            evidence: [],
          } as unknown as T,
          error: null,
          refresh: () => {},
        }
      }
      // Overview 主列表：/api/runs —— 给出 latest.runId，让 metrics 路径走 null 分支
      if (path === '/api/runs') {
        return {
          data: {
            runs: [
              {
                runId: 'run_a',
                hasEvents: true,
                hasReport: true,
              },
            ],
            manifestAvailable: true,
          } as unknown as T,
          error: null,
          refresh: () => {},
        }
      }
      // PluginSettings：/api/plugins —— 给一个 entry 让卡片渲染
      if (path === '/api/plugins') {
        return {
          data: {
            plugins: [
              {
                name: 'p',
                version: '1',
                enabled: true,
                config: null,
                configSchema: null,
              },
            ],
            stale: false,
          } as unknown as T,
          error: null,
          refresh: () => {},
        }
      }
      // ManifestBrowser：/api/runs/:runId/manifest —— 给一个最小 manifest
      if (path.endsWith('/manifest')) {
        return {
          data: {
            version: '1',
            source: { type: 'openapi', input: 'x', hash: 'h' },
            generatedAt: '',
            schemas: {},
            fields: [],
            endpoints: [{ id: 'e1', method: 'GET', path: '/users' }],
          } as unknown as T,
          error: null,
          refresh: () => {},
        }
      }
      // ManifestBrowser：/api/runs/:runId/fields —— 空 list（policyByPath 为空，徽章显 —）
      if (path.endsWith('/fields')) {
        return {
          data: { fields: [] } as unknown as T,
          error: null,
          refresh: () => {},
        }
      }
      // ManifestBrowser：/api/runs/:runId/requests —— 空 list（全部未 called）
      if (path.endsWith('/requests')) {
        return {
          data: { requests: [] } as unknown as T,
          error: null,
          refresh: () => {},
        }
      }
      // 兜底：默认返回 null data + null error（不抛错即可让页面走 loading 或正常分支）
      return { data: null as T | null, error: null, refresh: () => {} }
    },
  }
})

function renderPage(el: ReturnType<typeof createElement>): string {
  return renderToString(el).replace(/<!-- -->/g, '')
}

describe('Phase 4.5 UI render', () => {
  it('RequestDetail renders Replay section with button', async () => {
    const { RequestDetailPage } = await import('../ui/pages/RequestDetail')
    const html = renderPage(createElement(RequestDetailPage, { runId: 'run_a', requestId: 'req_1' }))
    expect(html).toContain('Replay')
    expect(html).toContain('Replay request')
  })

  it('Overview renders with useEventSource no-op branch (no EventSource in node)', async () => {
    const { OverviewPage } = await import('../ui/pages/Overview')
    const html = renderPage(createElement(OverviewPage, {}))
    expect(html).not.toContain('error 5')
    expect(typeof html).toBe('string')
  })

  it('PluginSettings renders cards with Copy YAML button', async () => {
    const { PluginSettingsPage } = await import('../ui/pages/PluginSettings')
    const html = renderPage(createElement(PluginSettingsPage, {}))
    expect(html).toContain('Plugins')
    expect(html).toContain('No schema exposed')
    expect(html).toContain('Copy YAML')
  })

  it('ManifestBrowser renders endpoints table + schema section', async () => {
    const { ManifestBrowserPage } = await import('../ui/pages/ManifestBrowser')
    const html = renderPage(createElement(ManifestBrowserPage, { runId: 'run_a' }))
    expect(html).toContain('Manifest')
    expect(html).toContain('Endpoints')
    expect(html).toContain('Schema')
  })
})

describe('yamlSnippet 类型分支（spec §4 UI 层）', () => {
  it('无 schema → 自由编辑提示（R8/E5）', async () => {
    const { yamlSnippet } = await import('../ui/yaml-snippet')
    const out = yamlSnippet({
      name: 'bare',
      version: '1.0.0',
      enabled: true,
      config: null,
      configSchema: null,
    })
    expect(out).toContain('no schema exposed')
  })

  it('properties 按类型给占位；required 无 ?；enum 给首值', async () => {
    const { yamlSnippet } = await import('../ui/yaml-snippet')
    const out = yamlSnippet({
      name: '@nx-mk/plugin-swagger',
      version: '0.1.0',
      enabled: true,
      config: null,
      configSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'swagger doc url' },
          retries: { type: 'integer' },
          strict: { type: 'boolean' },
          mode: { type: 'string', enum: ['read', 'live'] },
          tags: { type: 'array' },
        },
      },
    })
    expect(out).toContain('url: ')
    expect(out).not.toContain('url?:')
    expect(out).toContain('retries?: 0')
    expect(out).toContain('strict?: false')
    expect(out).toContain('"read"')
    expect(out).toContain('tags?: []')
    expect(out).toContain('# swagger doc url')
  })
})
