/** /runs/:runId/ignored —— Returned but ignored 清单（spec §3.4） */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { IgnoredListResponse } from '../../shared/api-types'

export function IgnoredListPage({ runId }: { runId: string }) {
  const T = useT()
  const { data, error } = usePolling<IgnoredListResponse>(`/api/runs/${runId}/ignored`)
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">{T('No coverage report for this run (overwritten by the latest run).')}</p>
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  return (
    <section>
      <h1>{T('Returned but ignored')} <span className="muted">({runId})</span></h1>
      {data.ignored.length === 0 ? (
        <p className="empty">{T('Nothing ignored-and-returned in this run.')}</p>
      ) : (
        <table>
          <thead><tr><th>{T('field')}</th><th>{T('hit count')}</th><th>{T('matched rule')}</th></tr></thead>
          <tbody>
            {data.ignored.map((f) => (
              <tr key={f.fieldId}>
                <td>{f.fieldPath}</td>
                <td>{f.hitCount ?? '—'}</td>
                <td>{f.matchedRule != null ? <code>{f.matchedRule.pattern}</code> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
