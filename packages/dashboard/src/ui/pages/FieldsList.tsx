/**
 * /runs/:runId/fields —— 四态分组列表（spec §3.4）：
 * 行内展开 policyStatus/hitCount/matchedRule/accessHit/uiHit
 * （evidence 的 textSample 展示在 RequestDetail——7 条路由契约不含 per-field evidence 查询）。
 */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import type { EnrichedCoverageFieldRow, FieldsListResponse } from '../../shared/api-types'

const STATES = ['covered', 'missing', 'ignored', 'notApplicable'] as const
const STATE_LABEL: Record<(typeof STATES)[number], string> = {
  covered: 'Covered',
  missing: 'Missing (required)',
  ignored: 'Ignored',
  notApplicable: 'Not applicable',
}

export function FieldsListPage({ runId }: { runId: string }) {
  const { data, error } = usePolling<FieldsListResponse>(`/api/runs/${runId}/fields`)
  if (error instanceof ApiError && error.status === 404) return <p className="empty">Run not found: {runId}</p>
  if (!data) return <p>loading…</p>
  if (data.fields.length === 0) {
    return (
      <section>
        <h1>Fields <span className="muted">({runId})</span></h1>
        <p className="empty">No coverage_fields rows for this run — run with <code>collect:</code> config to populate.</p>
      </section>
    )
  }
  return (
    <section>
      <h1>Fields <span className="muted">({runId})</span></h1>
      {STATES.map((state) => {
        const rows = data.fields.filter((f) => f.coverageState === state)
        if (rows.length === 0) return null
        return (
          <div className="section" key={state}>
            <h2>{STATE_LABEL[state]} <span className="muted">({rows.length})</span></h2>
            <table>
              <thead><tr><th>field</th><th>policy</th><th>access/ui</th><th>details</th></tr></thead>
              <tbody>
                {rows.map((f) => <FieldRow key={f.id} f={f} />)}
              </tbody>
            </table>
          </div>
        )
      })}
    </section>
  )
}

function FieldRow({ f }: { f: EnrichedCoverageFieldRow }) {
  return (
    <tr>
      <td>{f.fieldPath}</td>
      <td>{f.policyStatus}</td>
      <td>{f.accessHit === 1 ? 'access' : ''}{f.accessHit === 1 && f.uiHit === 1 ? ' + ' : ''}{f.uiHit === 1 ? 'ui' : ''}</td>
      <td>
        <details>
          <summary className="muted">details</summary>
          <div>
            {f.hitCount !== undefined && <p>hit count: {f.hitCount}</p>}
            {f.matchedRule !== undefined && (
              <p>
                rule: <code>{f.matchedRule.pattern}</code> ({f.matchedRule.source})
                {f.matchedRule.reason != null ? ` — ${f.matchedRule.reason}` : ''}
              </p>
            )}
            <p className="muted">counted: required={f.countedRequired ?? '—'} effective={f.countedEffective ?? '—'}</p>
          </div>
        </details>
      </td>
    </tr>
  )
}
