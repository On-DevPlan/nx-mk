/** / —— 最新 run 总览（spec §3.4）：三指标大数字 + 计数徽章 + goal 终止原因 */
import { useEventSource, usePolling } from '../hooks'
import { useT } from '../i18n'
import type { RunsListResponse, MetricsResponse } from '../../shared/api-types'

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function OverviewPage() {
  const T = useT()
  const { data: runsData, error: runsError, refresh } = usePolling<RunsListResponse>('/api/runs')
  const latest = runsData?.runs.find((r) => r.hasReport) ?? null
  const metrics = usePolling<MetricsResponse>(latest ? `/api/runs/${latest.runId}/metrics` : null)
  // Phase 4.5（R11）：SSE 事件到达 → 立即 refresh（轮询保留，SSE 只是加速器）
  const { connected } = useEventSource('/api/events', () => refresh())
  if (runsError !== null && runsData === null) return <p className="error">{T('failed to load runs')}</p>
  if (!runsData) return <p className="loading">{T('loading…')}</p>
  if (runsData.runs.length === 0) {
    return <p className="empty">{T('No runs yet — run {cmd} first.', { cmd: 'nx-mk run' })}</p>
  }
  const m = metrics.data?.metrics
  return (
    <section>
      <h1>
        {T('Overview')} {latest !== null ? <span className="muted">({latest.runId})</span> : null}
        {connected ? <span className="badge live">{T('live')}</span> : null}
      </h1>
      {latest?.terminatedBy != null && (
        <span className="badge ok">{T('terminated: {reason}', { reason: latest.terminatedBy })}</span>
      )}
      {m !== undefined ? (
        <div className="cards">
          <div className="card"><div className="num">{pct(m.requiredCoverage)}</div><div className="label">{T('required')}</div></div>
          <div className="card"><div className="num">{pct(m.effectiveCoverage)}</div><div className="label">{T('effective')}</div></div>
          <div className="card"><div className="num">{pct(m.rawBackendFieldCoverage)}</div><div className="label">{T('raw backend')}</div></div>
        </div>
      ) : (
        <p className="empty">{T('No coverage report yet — it is written when a run finishes.')}</p>
      )}
      {m !== undefined && (
        <div className="counts">
          <span className="badge warn">{T('missing required: {n}', { n: m.missingRequiredFields })}</span>
          <span className="badge">{T('ignored returned: {n}', { n: m.ignoredReturnedFields })}</span>
          <span className="badge">{T('suspicious: {n}', { n: m.suspiciousFields })}</span>
          <span className="badge">{T('endpoints: {called}/{total}', { called: m.endpointsCalled, total: m.endpointsTotal })}</span>
        </div>
      )}
    </section>
  )
}
