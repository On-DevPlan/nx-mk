/** /runs/:runId —— 单 run 报告总览：三指标 + 四清单计数 + endpoints 比例 */
import { ApiError } from '../api'
import { useEventSource, usePolling } from '../hooks'
import { useT } from '../i18n'
import type { MetricsResponse, RunDetailResponse } from '../../shared/api-types'

export function RunOverviewPage({ runId }: { runId: string }) {
  const T = useT()
  const detail = usePolling<RunDetailResponse>(`/api/runs/${runId}`)
  const metrics = usePolling<MetricsResponse>(`/api/runs/${runId}/metrics`)
  // Phase 4.5（R11）：SSE 事件到达 → 立即 refresh（轮询保留，SSE 只是加速器）
  const { connected } = useEventSource(`/api/events?runId=${runId}`, () => detail.refresh())
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return <p className="empty">{T('Run not found: {id}', { id: runId })}</p>
  }
  if (detail.error instanceof ApiError) {
    return (
      <p className="error">
        {T('error {code}: {detail}', { code: detail.error.status, detail: detail.error.detailMessage })}
      </p>
    )
  }
  if (!detail.data) return <p className="loading">{T('loading…')}</p>
  const m = metrics.error instanceof ApiError ? undefined : metrics.data?.metrics
  return (
    <section>
      <h1>{runId} {connected ? <span className="badge live">{T('live')}</span> : null}</h1>
      {detail.data.terminatedBy != null && (
        <span className="badge ok">{T('terminated: {reason}', { reason: detail.data.terminatedBy })}</span>
      )}
      {m !== undefined ? (
        <>
          <div className="cards">
            <div className="card"><div className="num">{Math.round(m.requiredCoverage * 100)}%</div><div className="label">{T('required')}</div></div>
            <div className="card"><div className="num">{Math.round(m.effectiveCoverage * 100)}%</div><div className="label">{T('effective')}</div></div>
            <div className="card"><div className="num">{Math.round(m.rawBackendFieldCoverage * 100)}%</div><div className="label">{T('raw backend')}</div></div>
          </div>
          <div className="counts">
            <a className="badge warn" href={`#/runs/${runId}/fields`}>{T('missing required: {n}', { n: m.missingRequiredFields })}</a>
            <a className="badge" href={`#/runs/${runId}/ignored`}>{T('ignored returned: {n}', { n: m.ignoredReturnedFields })}</a>
            <a className="badge" href={`#/runs/${runId}/fields`}>{T('suspicious: {n}', { n: m.suspiciousFields })}</a>
            <span className="badge">{T('endpoints: {called}/{total}', { called: m.endpointsCalled, total: m.endpointsTotal })}</span>
            <span className="badge">{T('fields returned: {a}/{b}', { a: m.fieldsReturned, b: m.fieldsTotal })}</span>
          </div>
        </>
      ) : (
        <p className="empty">
          {T('No coverage report for this run (report is overwritten by the latest run). Requests and fields remain available below.')}
        </p>
      )}
      <div className="section">
        <a href={`#/runs/${runId}/requests`}>{T('Requests →')}</a>
        {'　'}
        <a href={`#/runs/${runId}/fields`}>{T('Fields →')}</a>
        {'　'}
        <a href={`#/runs/${runId}/ignored`}>{T('Ignored →')}</a>
        {'　'}
        <a href={`#/runs/${runId}/manifest`}>{T('Manifest browser')}</a>
      </div>
    </section>
  )
}
