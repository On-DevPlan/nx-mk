/**
 * /runs/:runId/manifest —— manifest 树 + schema 表（spec U6/E8）。
 * 左：endpoints 列表（method 徽章 / called / 字段数）；右：选中 endpoint 的字段表
 * （字段 / 类型 / required / policyStatus 徽章）。policyStatus 来自 fields 路由；
 * called 判定 = requests 列表 path 命中。行锚点链 fields 页。
 *
 * 字段命名对齐 shared/api-types.ts：
 * - FieldsListResponse.fields[*] = EnrichedCoverageFieldRow[] —— policyStatus 取自 .policyStatus，key 用 .fieldPath
 *   （coverage-analyzer 写入时 field_path ← manifest.fields[].normalizedPath，故值同 normalizedPath）
 * - ManifestFieldView[*] —— .normalizedPath / .type / .required
 * - RequestsListResponse.requests[*] = RequestTraceSummary[] —— .path 可选
 */
import { useState } from 'react'
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type {
  ManifestResponse,
  FieldsListResponse,
  RequestsListResponse,
} from '../../shared/api-types'

export function ManifestBrowserPage({ runId }: { runId: string }) {
  const T = useT()
  const manifest = usePolling<ManifestResponse>(`/api/runs/${runId}/manifest`)
  const fields = usePolling<FieldsListResponse>(`/api/runs/${runId}/fields`)
  const requests = usePolling<RequestsListResponse>(`/api/runs/${runId}/requests`)
  const [selected, setSelected] = useState<string | null>(null)

  if (manifest.error instanceof ApiError && manifest.error.status === 404) {
    return (
      <p className="empty">
        No manifest snapshot for this run (run predates Phase 4.5 or manifest was invalid).
      </p>
    )
  }
  if (manifest.error instanceof ApiError) {
    return (
      <p className="error">
        {T('error {code}: {detail}', { code: manifest.error.status, detail: manifest.error.detailMessage })}
      </p>
    )
  }
  if (!manifest.data) return <p>{T('loading…')}</p>

  const m = manifest.data
  // policyStatus 映射：fieldPath → policyStatus（fields 路由失败时徽章显 —）
  const policyByPath = new Map<string, string>()
  if (fields.data) {
    for (const f of fields.data.fields) {
      if (!policyByPath.has(f.fieldPath)) policyByPath.set(f.fieldPath, f.policyStatus)
    }
  }
  const requestedPaths = new Set<string>()
  if (requests.data) {
    for (const r of requests.data.requests) {
      if (r.path) requestedPaths.add(r.path)
    }
  }
  const current = m.endpoints.find((e) => e.id === selected) ?? m.endpoints[0]
  const currentFields = current ? m.fields.filter((f) => f.endpointId === current.id) : []

  return (
    <section>
      <h1>{T('Manifest')}</h1>
      <p>
        <a href={`#/runs/${runId}`}>{T('← Run')}</a>
      </p>
      <p>
        {m.version} · {m.source.type} · {T('{n} endpoints · {m} fields', { n: m.endpoints.length, m: m.fields.length })}
      </p>
      <div className="section">
        <h2>{T('Endpoints')}</h2>
        <table>
          <thead>
            <tr>
              <th>{T('method')}</th>
              <th>{T('path')}</th>
              <th>{T('called')}</th>
              <th>{T('fields')}</th>
            </tr>
          </thead>
          <tbody>
            {m.endpoints.map((e) => (
              <tr
                key={e.id}
                onClick={() => setSelected(e.id)}
                style={{
                  cursor: 'pointer',
                  fontWeight: current?.id === e.id ? 'bold' : 'normal',
                }}
              >
                <td>
                  <span className="badge">{e.method}</span>
                </td>
                <td>{e.path}</td>
                <td>{requestedPaths.has(e.path) ? '✓' : '—'}</td>
                <td>{m.fields.filter((f) => f.endpointId === e.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current && (
        <div className="section">
          <h2>
            Schema — <span className="badge">{current.method}</span> {current.path}
          </h2>
          {currentFields.length === 0 ? (
            <p className="empty">{T('no fields')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{T('field')}</th>
                  <th>{T('type')}</th>
                  <th>{T('required')}</th>
                  <th>{T('policy')}</th>
                </tr>
              </thead>
              <tbody>
                {currentFields.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <a href={`#/runs/${runId}/fields`}>{f.normalizedPath}</a>
                    </td>
                    <td>{f.type}</td>
                    <td>{f.required === true ? '✓' : '—'}</td>
                    <td>
                      <span className="badge">{policyByPath.get(f.normalizedPath) ?? '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
