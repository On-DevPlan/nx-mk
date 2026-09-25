/** /runs —— 历史运行列表（spec §3.4） */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { RunsListResponse } from '../../shared/api-types'

export function RunsListPage() {
  const T = useT()
  const { data, error } = usePolling<RunsListResponse>('/api/runs')
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  return (
    <section>
      <h1>{T('Runs')}</h1>
      {data.runs.length === 0 ? (
        <p className="empty">{T('No runs yet — run {cmd} first.', { cmd: 'nx-mk run' })}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{T('run')}</th><th>{T('status')}</th><th>{T('started')}</th>
              <th>{T('ended')}</th><th>{T('terminated')}</th><th>{T('report')}</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.runId}>
                <td><a href={`#/runs/${r.runId}`}>{r.runId}</a></td>
                <td>{r.status ?? '—'}</td>
                <td>{r.startedAt ?? '—'}</td>
                <td>{r.endedAt ?? '—'}</td>
                <td>{r.terminatedBy ?? '—'}</td>
                <td>{r.hasReport ? T('yes') : T('no')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
