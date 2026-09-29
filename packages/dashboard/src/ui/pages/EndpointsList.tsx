/**
 * /runs/:runId/endpoints —— per-endpoint 覆盖列表（C14，§30.1 补页）：
 * 数据 = coverage-report.json endpoints（report 命中该 run 时可用，D12 同 metrics）；
 * 未调用的 endpoint 置灰分组置顶（missing 视角），called 在下。
 */
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { EndpointsListResponse } from '../../shared/api-types'

export function EndpointsListPage({ runId }: { runId: string }) {
  const T = useT()
  const { data, error } = usePolling<EndpointsListResponse>(`/api/runs/${runId}/endpoints`)
  if (error instanceof ApiError && error.status === 404) {
    return (
      <section>
        <h1>{T('Endpoints')} <span className="muted">({runId})</span></h1>
        <p className="empty">{T('No coverage report for this run (report is overwritten by the latest run). Requests and fields remain available below.')}</p>
      </section>
    )
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  const notCalled = data.endpoints.filter((e) => !e.called)
  const called = data.endpoints.filter((e) => e.called)
  if (data.endpoints.length === 0) {
    return (
      <section>
        <h1>{T('Endpoints')} <span className="muted">({runId})</span></h1>
        <p className="empty">{T('no endpoints in manifest — check openapi config.')}</p>
      </section>
    )
  }
  return (
    <section>
      <h1>{T('Endpoints')} <span className="muted">({runId})</span></h1>
      {[
        { key: 'not called', rows: notCalled },
        { key: 'called', rows: called },
      ].map(({ key, rows }) =>
        rows.length === 0 ? null : (
          <div className="section" key={key}>
            <h2>{T(key)} <span className="muted">({rows.length})</span></h2>
            <table>
              <thead>
                <tr><th>{T('endpoint')}</th><th>{T('fields')}</th><th>{T('leg')}</th></tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.endpointId} className={e.called ? undefined : 'muted'}>
                    <td><code>{e.method} {e.path}</code></td>
                    <td>{e.fieldsCovered}/{e.fieldsTotal}</td>
                    <td>{e.called ? T('called') : T('not called')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </section>
  )
}
