/** /runs/:runId/requests —— 请求列表（report.requests 或 db 投影） */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import type { RequestsListResponse } from '../../shared/api-types'

export function RequestsListPage({ runId }: { runId: string }) {
  const { data, error } = usePolling<RequestsListResponse>(`/api/runs/${runId}/requests`)
  if (error instanceof ApiError && error.status === 404) return <p className="empty">Run not found: {runId}</p>
  if (!data) return <p>loading…</p>
  return (
    <section>
      <h1>Requests <span className="muted">({runId})</span></h1>
      {data.requests.length === 0 ? (
        <p className="empty">No requests captured in this run.</p>
      ) : (
        <table>
          <thead>
            <tr><th>method</th><th>path / url</th><th>status</th><th>duration</th><th>started</th></tr>
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
                <td>{r.startedAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
