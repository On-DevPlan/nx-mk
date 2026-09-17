/** /runs —— 历史运行列表（spec §3.4） */
import { usePolling } from '../hooks'
import type { RunsListResponse } from '../../shared/api-types'

export function RunsListPage() {
  const { data } = usePolling<RunsListResponse>('/api/runs')
  if (!data) return <p>loading…</p>
  return (
    <section>
      <h1>Runs</h1>
      {data.runs.length === 0 ? (
        <p className="empty">No runs yet — run <code>nx-mk run</code> first.</p>
      ) : (
        <table>
          <thead>
            <tr><th>run</th><th>status</th><th>started</th><th>ended</th><th>terminated</th><th>report</th></tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.runId}>
                <td><a href={`#/runs/${r.runId}`}>{r.runId}</a></td>
                <td>{r.status ?? '—'}</td>
                <td>{r.startedAt ?? '—'}</td>
                <td>{r.endedAt ?? '—'}</td>
                <td>{r.terminatedBy ?? '—'}</td>
                <td>{r.hasReport ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
