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
})
