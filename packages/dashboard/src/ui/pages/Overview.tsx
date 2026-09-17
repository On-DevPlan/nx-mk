/** / —— 最新 run 总览（spec §3.4）：三指标大数字 + 计数徽章 + goal 终止原因 */
import { usePolling } from '../hooks'
import type { RunsListResponse, MetricsResponse } from '../../shared/api-types'

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function OverviewPage() {
  const runs = usePolling<RunsListResponse>('/api/runs')
  const latest = runs.data?.runs.find((r) => r.hasReport) ?? null
  const metrics = usePolling<MetricsResponse>(latest ? `/api/runs/${latest.runId}/metrics` : null)
  if (runs.error !== null && runs.data === null) return <p className="error">failed to load runs</p>
  if (!runs.data) return <p>loading…</p>
  if (runs.data.runs.length === 0) {
    return <p className="empty">No runs yet — run <code>nx-mk run</code> first.</p>
  }
  const m = metrics.data?.metrics
  return (
    <section>
      <h1>
        Overview {latest !== null ? <span className="muted">({latest.runId})</span> : null}
      </h1>
      {latest?.terminatedBy != null && <span className="badge ok">terminated: {latest.terminatedBy}</span>}
      {m !== undefined ? (
        <div className="cards">
          <div className="card"><div className="num">{pct(m.requiredCoverage)}</div><div className="label">required</div></div>
          <div className="card"><div className="num">{pct(m.effectiveCoverage)}</div><div className="label">effective</div></div>
          <div className="card"><div className="num">{pct(m.rawBackendFieldCoverage)}</div><div className="label">raw backend</div></div>
        </div>
      ) : (
        <p className="empty">No coverage report yet — it is written when a run finishes.</p>
      )}
      {m !== undefined && (
        <div className="counts">
          <span className="badge warn">missing required: {m.missingRequiredFields}</span>
          <span className="badge">ignored returned: {m.ignoredReturnedFields}</span>
          <span className="badge">suspicious: {m.suspiciousFields}</span>
          <span className="badge">endpoints: {m.endpointsCalled}/{m.endpointsTotal}</span>
        </div>
      )}
    </section>
  )
}
