/** /runs/:runId/requests —— 请求列表（report.requests 或 db 投影） */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { RequestsListResponse } from '../../shared/api-types'

export function RequestsListPage({ runId }: { runId: string }) {
  const T = useT()
  const { data, error } = usePolling<RequestsListResponse>(`/api/runs/${runId}/requests`)
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">{T('Run not found: {id}', { id: runId })}</p>
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p>{T('loading…')}</p>
  return (
    <section>
      <h1>{T('Requests')} <span className="muted">({runId})</span></h1>
      {data.requests.length === 0 ? (
        <p className="empty">{T('No requests captured in this run.')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{T('method')}</th><th>{T('path / url')}</th><th>{T('status')}</th>
              <th>{T('duration')}</th><th>{T('started')}</th>
            </tr>
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
