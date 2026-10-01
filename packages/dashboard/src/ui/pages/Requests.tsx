/**
 * /requests（请求 tab 首页，3-tab 重构）—— 顶部统计条（DSL 驱动完成数）+ 请求列表。
 * 复用 /api/runs/:runId/metrics（endpointsCalled/total）与 /api/runs/:runId/requests。
 * 逐请求详情（复现/响应值）由既有 RequestDetail 页承担（行内链接跳转）。
 */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { RequestsListResponse, MetricsResponse, RunsListResponse } from '../../shared/api-types'

/** 统计条（独立导出便于测试）：请求 tab 顶部「DSL 驱动完成 x/y」 */
export function RequestsStats({ runId }: { runId: string }) {
  const T = useT()
  const { data } = usePolling<MetricsResponse>(`/api/runs/${encodeURIComponent(runId)}/metrics`)
  const m = data?.metrics ?? null
  return (
    <div className="section">
      <h2>{T('DSL driven')}</h2>
      <p className="cards">
        <span className="card"><span className="num">{m !== null ? `${m.endpointsCalled}/${m.endpointsTotal}` : '—'}</span><span className="label">{T('endpoints')}</span></span>
        <span className="card"><span className="num">{m !== null ? m.fieldsReturned : '—'}</span><span className="label">{T('fields')}</span></span>
        <span className="card"><span className="num">{m !== null ? m.requiredFields : '—'}</span><span className="label">{T('required')}</span></span>
      </p>
      <p>
        <a href={`#/runs/${encodeURIComponent(runId)}/requests`}>{T('Requests →')}</a>
      </p>
    </div>
  )
}

/** 请求 tab 首页：统计 + 请求全列表（含行内复现状态色） */
export function RequestsPage({ runId }: { runId: string }) {  const T = useT()
  const { data, error } = usePolling<RequestsListResponse>(`/api/runs/${encodeURIComponent(runId)}/requests`)
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">{T('Run not found: {id}', { id: runId })}</p>
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  return (
    <section>
      <h1>{T('Requests')}</h1>
      <RequestsStats runId={runId} />
      {data.requests.length === 0 ? (
        <p className="empty">{T('No requests captured in this run.')}</p>
      ) : (
        <table>
          <thead>
            <tr><th>{T('method')}</th><th>{T('path / url')}</th><th>{T('status')}</th><th>{T('duration')}</th></tr>
          </thead>
          <tbody>
            {data.requests.map((r, i) => (
              <tr key={r.requestId ?? i}>
                <td>{r.method ?? '—'}</td>
                <td>
                  {r.requestId != null
                    ? <a href={`#/runs/${runId}/requests/${r.requestId}`}>{r.path ?? r.url ?? r.requestId}</a>
                    : (r.path ?? r.url ?? '—')}
                </td>
                <td>{r.status ?? '—'}</td>
                <td>{r.durationMs != null ? `${r.durationMs}ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** /requests（无 runId 入口）：自动取最新有报告的 run，跳去 RequestsPage 内容 */
export function RequestsHomePage() {
  const T = useT()
  const { data, error } = usePolling<RunsListResponse>('/api/runs')
  if (error !== null) return <p className="error">{T('failed to load runs')}</p>
  if (!data) return <p className="loading">{T('loading…')}</p>
  const latest = data.runs.find((r) => r.hasReport) ?? data.runs[0] ?? null
  if (latest === null) {
    return <p className="empty">{T('No runs yet — run {cmd} first.', { cmd: 'nx-mk run' })}</p>
  }
  return <RequestsPage runId={latest.runId} />
}
