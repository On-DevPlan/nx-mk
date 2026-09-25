/**
 * /runs/:runId/fields —— 四态分组列表（spec §3.4）：
 * 行内展开 policyStatus/hitCount/matchedRule/accessHit/uiHit
 * （evidence 的 textSample 展示在 RequestDetail——7 条路由契约不含 per-field evidence 查询）。
 */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { EnrichedCoverageFieldRow, FieldsListResponse } from '../../shared/api-types'

const STATES = ['covered', 'missing', 'ignored', 'notApplicable'] as const

export function FieldsListPage({ runId }: { runId: string }) {
  const T = useT()
  const { data, error } = usePolling<FieldsListResponse>(`/api/runs/${runId}/fields`)
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">{T('Run not found: {id}', { id: runId })}</p>
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  if (data.fields.length === 0) {
    return (
      <section>
        <h1>{T('Fields')} <span className="muted">({runId})</span></h1>
        <p className="empty">{T('No coverage_fields rows for this run — run with {cmd} config to populate.', { cmd: 'collect:' })}</p>
      </section>
    )
  }
  return (
    <section>
      <h1>{T('Fields')} <span className="muted">({runId})</span></h1>
      {STATES.map((state) => {
        const rows = data.fields.filter((f) => f.coverageState === state)
        if (rows.length === 0) return null
        return (
          <div className="section" key={state}>
            <h2>{T(STATE_LABEL[state])} <span className="muted">({rows.length})</span></h2>
            <table>
              <thead>
                <tr><th>{T('field')}</th><th>{T('policy')}</th><th>{T('access/ui')}</th><th>{T('details')}</th></tr>
              </thead>
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

/** 四态文案键（经 t() 走词典；键 = 英文原文） */
const STATE_LABEL: Record<(typeof STATES)[number], string> = {
  covered: 'Covered',
  missing: 'Missing (required)',
  ignored: 'Ignored',
  notApplicable: 'Not applicable',
}

function FieldRow({ f }: { f: EnrichedCoverageFieldRow }) {
  const T = useT()
  return (
    <tr>
      <td>{f.fieldPath}</td>
      <td>{f.policyStatus}</td>
      <td>{f.accessHit === 1 ? 'access' : ''}{f.accessHit === 1 && f.uiHit === 1 ? ' + ' : ''}{f.uiHit === 1 ? 'ui' : ''}</td>
      <td>
        <details>
          <summary className="muted">{T('details')}</summary>
          <div>
            {f.hitCount !== undefined && <p>{T('hit count: {n}', { n: f.hitCount })}</p>}
            {f.matchedRule !== undefined && (
              <p>
                {T('rule')}: <code>{f.matchedRule.pattern}</code> ({f.matchedRule.source})
                {f.matchedRule.reason != null ? ` — ${f.matchedRule.reason}` : ''}
              </p>
            )}
            <p className="muted">{T('counted: required={a} effective={b}', { a: f.countedRequired ?? '—', b: f.countedEffective ?? '—' })}</p>
          </div>
        </details>
      </td>
    </tr>
  )
}
