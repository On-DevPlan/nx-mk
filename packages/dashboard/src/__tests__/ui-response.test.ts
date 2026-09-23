/**
 * RequestDetail「响应值」区渲染（trace.responsePreview 通道）：
 * 有值 → pre 展示；null → 'not recorded' 占位。
 * usePolling 模块级 mock 按 path 分发（与 ui-phase45 同手法）。
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

const previewValue = '{"id":"u1","name":"Ada"}'

vi.mock('../ui/hooks', () => ({
  usePolling: <T,>(path: string | null) => {
    void path
    return {
      data: {
        trace: {
          id: 't', runId: 'run_a', traceId: 'req_1', scenarioId: null, dslStepId: null,
          endpointId: null, method: 'GET', url: 'http://api.local/users/1', path: '/users/1',
          status: 200, durationMs: 12, startedAt: null, endedAt: null,
          replayable: null, replaySafety: null, replayReason: null,
          responsePreview: previewValue,
        },
        hits: [],
        evidence: [],
      } as unknown as T,
      error: null,
      refresh: () => {},
    }
  },
  useEventSource: () => ({ connected: false }),
}))

function renderPage(el: ReturnType<typeof createElement>): string {
  return renderToString(el).replace(/<!-- -->/g, '')
}

describe('RequestDetail 响应值区', () => {
  it('responsePreview 有值 → pre 展示采集到的响应 JSON', async () => {
    const { RequestDetailPage } = await import('../ui/pages/RequestDetail')
    const html = renderPage(createElement(RequestDetailPage, { runId: 'run_a', requestId: 'req_1' }))
    expect(html).toContain('Response body')
    // renderToString 对 pre 内文本做 HTML 转义（" → &quot;）
    expect(html).toContain('&quot;id&quot;:&quot;u1&quot;,&quot;name&quot;:&quot;Ada&quot;')
  })

  it('zh 语言下标题显「响应值」（finally 复位 en）', async () => {
    const { RequestDetailPage } = await import('../ui/pages/RequestDetail')
    const { setLang } = await import('../ui/i18n')
    try {
      setLang('zh')
      const html = renderPage(createElement(RequestDetailPage, { runId: 'run_a', requestId: 'req_1' }))
      expect(html).toContain('响应值')
    } finally {
      setLang('en')
    }
  })
})
