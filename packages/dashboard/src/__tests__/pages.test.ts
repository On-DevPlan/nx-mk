/**
 * B6: 非 404 错误（500/503）在 UI 页面必须显示错误态，不能永远 loading。
 * 用 react-dom/server renderToString 在 node 环境渲染页面（无 jsdom 依赖）。
 * hooks 的 usePolling 模块级 mock（vi.mock 自动提升）：全部用例统一返回 500 错误态。
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

// ApiError 实例用真类（页面的 instanceof 判别依赖类同一性），vi.hoisted 跨提升引用
const err500 = vi.hoisted(async () => {
  const { ApiError } = await import('../ui/api.js')
  return new ApiError(500, { detail: 'internal error' })
})

vi.mock('../ui/hooks', async () => {
  const error = await err500
  return {
    usePolling: <T,>() => ({ data: null as T | null, error }),
    // Phase 4.5: RunOverview 在错误路径下也调用 useEventSource；mock 成 no-op 让现有 B6 断言继续生效
    useEventSource: () => ({ connected: false }),
  }
})

function renderPage(el: ReturnType<typeof createElement>): string {
  // renderToString 在相邻文本节点间插入 <!-- -->；剥掉便于断言
  return renderToString(el).replace(/<!-- -->/g, '')
}

describe('B6: non-404 errors surface in UI (not stuck loading)', () => {
  it('FieldsList: 500 shows error, not loading', async () => {
    const { FieldsListPage } = await import('../ui/pages/FieldsList')
    const html = renderPage(createElement(FieldsListPage, { runId: 'run_a' }))
    expect(html).toContain('error 500')
    expect(html).not.toContain('loading…')
  })

  it('IgnoredList: 500 shows error, not loading', async () => {
    const { IgnoredListPage } = await import('../ui/pages/IgnoredList')
    const html = renderPage(createElement(IgnoredListPage, { runId: 'run_a' }))
    expect(html).toContain('error 500')
    expect(html).not.toContain('loading…')
  })

  it('RequestsList: 500 shows error, not loading', async () => {
    const { RequestsListPage } = await import('../ui/pages/RequestsList')
    const html = renderPage(createElement(RequestsListPage, { runId: 'run_a' }))
    expect(html).toContain('error 500')
    expect(html).not.toContain('loading…')
  })

  it('RequestDetail: 500 shows error, not loading', async () => {
    const { RequestDetailPage } = await import('../ui/pages/RequestDetail')
    const html = renderPage(createElement(RequestDetailPage, { runId: 'run_a', requestId: 'req_1' }))
    expect(html).toContain('error 500')
    expect(html).not.toContain('loading…')
  })

  it('RunOverview: 500 shows error, not loading', async () => {
    const { RunOverviewPage } = await import('../ui/pages/RunOverview')
    const html = renderPage(createElement(RunOverviewPage, { runId: 'run_a' }))
    expect(html).toContain('error 500')
    expect(html).not.toContain('loading…')
  })

  it('RunsList: 500 shows error, not loading', async () => {
    const { RunsListPage } = await import('../ui/pages/RunsList')
    const html = renderPage(createElement(RunsListPage, {}))
    expect(html).toContain('error 500')
    expect(html).not.toContain('loading…')
  })
})
