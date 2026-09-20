/** /runs/:runId —— 单 run 报告总览：三指标 + 四清单计数 + endpoints 比例 */
import { ApiError } from '../api'
import { useEventSource, usePolling } from '../hooks'
import type { MetricsResponse, RunDetailResponse } from '../../shared/api-types'

export function RunOverviewPage({ runId }: { runId: string }) {
  const detail = usePolling<RunDetailResponse>(`/api/runs/${runId}`)
  const metrics = usePolling<MetricsResponse>(`/api/runs/${runId}/metrics`)
  // Phase 4.5（R11）：SSE 事件到达 → 立即 refresh（轮询保留，SSE 只是加速器）
  const { connected } = useEventSource(`/api/events?runId=${runId}`, () => detail.refresh())
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return <p className="empty">Run not found: {runId}</p>
  }
  if (detail.error instanceof ApiError) return <p className="error">error {detail.error.status}: {detail.error.detailMessage}</p>
  if (!detail.data) return <p>loading…</p>
  const m = metrics.error instanceof ApiError ? undefined : metrics.data?.metrics
  return (
    <section>
      <h1>{runId} {connected ? <span className="badge">live</span> : null}</h1>
      {detail.data.terminatedBy != null && <span className="badge ok">terminated: {detail.data.terminatedBy}</span>}
      {m !== undefined ? (
        <>
          <div className="cards">
            <div className="card"><div className="num">{Math.round(m.requiredCoverage * 100)}%</div><div className="label">required</div></div>
            <div className="card"><div className="num">{Math.round(m.effectiveCoverage * 100)}%</div><div className="label">effective</div></div>
            <div className="card"><div className="num">{Math.round(m.rawBackendFieldCoverage * 100)}%</div><div className="label">raw backend</div></div>
          </div>
          <div className="counts">
            <a className="badge warn" href={`#/runs/${runId}/fields`}>missing required: {m.missingRequiredFields}</a>
            <a className="badge" href={`#/runs/${runId}/ignored`}>ignored returned: {m.ignoredReturnedFields}</a>
            <a className="badge" href={`#/runs/${runId}/fields`}>suspicious: {m.suspiciousFields}</a>
            <span className="badge">endpoints: {m.endpointsCalled}/{m.endpointsTotal}</span>
            <span className="badge">fields returned: {m.fieldsReturned}/{m.fieldsTotal}</span>
          </div>
        </>
      ) : (
        <p className="empty">
          No coverage report for this run (report is overwritten by the latest run).
          Requests and fields remain available below.
        </p>
      )}
      <div className="section">
        <a href={`#/runs/${runId}/requests`}>Requests →</a>
        {'　'}
        <a href={`#/runs/${runId}/fields`}>Fields →</a>
        {'　'}
        <a href={`#/runs/${runId}/ignored`}>Ignored →</a>
      </div>
    </section>
  )
}
