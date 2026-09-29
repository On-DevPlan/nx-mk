/**
 * /runs/:runId/agent —— Agent Loop 迭代报告（C14，§30.1 补页）：
 * 数据 = §25.9 agent_iterations 行（listAgentIterations）。
 * loop 未跑 → 空态；afterCoverage 恒 null（v0 行为锁定：不做 mid-loop 重测，
 * 见 Plan §47.8.3）→ 不渲染后置差值列，渲染值语义「before coverage」由 UI
 * 计算上一行状态的百分比展示（beforeCoverage 是小数比例）。
 */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { AgentIterationsResponse } from '../../shared/api-types'

const STATUS_LABEL: Record<string, string> = {
  produced: 'Produced',
  rejected: 'Rejected (review guard)',
  failed: 'Failed',
  'given-up': 'Given up',
}

export function AgentPage({ runId }: { runId: string }) {
  const T = useT()
  const { data, error } = usePolling<AgentIterationsResponse>(`/api/runs/${runId}/agent`)
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">{T('Run not found: {id}', { id: runId })}</p>
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  return (
    <section>
      <h1>{T('Agent Loop')} <span className="muted">({runId})</span></h1>
      {data.iterations.length === 0 ? (
        <p className="empty">
          {T('no agent iterations for this run — run {cmd} to populate.', { cmd: 'nx-mk loop' })}
        </p>
      ) : (
        <table>
          <thead>
            <tr><th>#</th><th>{T('status')}</th><th>{T('before coverage')}</th><th>{T('summary')}</th><th>{T('timing')}</th><th>{T('diff')}</th></tr>
          </thead>
          <tbody>
            {data.iterations.map((it) => (
              <tr key={it.id}>
                <td>{it.iteration}</td>
                <td>{it.status === 'rejected' ? T(STATUS_LABEL.rejected!) : (STATUS_LABEL[it.status] != null ? T(STATUS_LABEL[it.status]!) : it.status)}</td>
                <td>{it.beforeCoverage != null ? `${Math.round(it.beforeCoverage * 100)}%` : '—'}</td>
                <td style={{ textAlign: 'left' }}>{it.summary ?? '—'}</td>
                <td>
                  {it.startedAt != null ? new Date(it.startedAt).toLocaleString() : '—'}
                  {it.endedAt != null && it.startedAt != null ? ` → ${((new Date(it.endedAt).getTime() - new Date(it.startedAt).getTime()) / 1000).toFixed(1)}s` : it.endedAt != null ? ` → ${new Date(it.endedAt).toLocaleString()}` : ''}
                </td>
                <td>{it.diffPath != null ? <code>{it.diffPath}</code> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
