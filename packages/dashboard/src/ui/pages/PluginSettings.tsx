/**
 * /settings/plugins —— 插件清单 + YAML 片段 + per-plugin config 编辑器（spec U3/R6-R8 + v1 写回链 W2/WP3）。
 * stale → 「kernel 未产出清单」提示（E4）；无 schema → 「No schema exposed」（R8）；
 * 复制按钮走 navigator.clipboard（node 渲染环境不触发，浏览器生效）。
 */
import { useState } from 'react'
import { ApiError, patchJson } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import { yamlSnippet } from '../yaml-snippet'
import type { PluginEntryView, PluginsResponse } from '../../shared/api-types'
import type { ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../../shared/api-types'

export function PluginSettingsPage() {
  const T = useT()
  const { data, error } = usePolling<PluginsResponse>('/api/plugins')
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">{T('Plugins endpoint not found.')}</p>
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  if (data.stale) {
    return (
      <section>
        <h1>{T('Plugins')}</h1>
        <p className="empty">{T('kernel has not produced plugins-manifest.json yet — run once first.')}</p>
      </section>
    )
  }
  return (
    <section>
      <h1>{T('Plugins')}</h1>
      <p className="empty">
        {T('Edit per-plugin config — Preview shows the YAML diff; Apply writes nx-mk.config.yml (a .bak backup is kept). Takes effect on the next run.')}
      </p>
      {data.plugins.map((p) => (
        <PluginCard key={p.name} entry={p} />
      ))}
    </section>
  )
}

function PluginCard({ entry }: { entry: PluginEntryView }) {
  const T = useT()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const snippet = yamlSnippet(entry)
  return (
    <div className="section">
      <h2>
        {entry.name} <span className="badge">v{entry.version}</span>{' '}
        {entry.enabled ? <span className="badge">enabled</span> : null}
      </h2>
      {entry.configSchema === null ? <p className="empty">{T('No schema exposed')}</p> : null}
      <pre>{snippet}</pre>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(snippet).then(() => setCopied(true))
        }}
      >
        {copied ? T('Copied!') : T('Copy YAML')}
      </button>{' '}
      <button onClick={() => setEditing(!editing)}>{T('Edit config')}</button>
      {editing ? <ConfigEditor name={entry.name} initial={entry.config} /> : null}
    </div>
  )
}

/** v1 编辑器（WP3）：JSON ⊂ YAML，textarea 以 JSON 编辑 per-plugin config；两段式 Preview→Apply（W2）。 */
export function ConfigEditor({ name, initial }: { name: string; initial: unknown }) {
  const T = useT()
  const [text, setText] = useState(() => {
    try {
      return JSON.stringify(initial ?? {}, null, 2)
    } catch {
      return '{}'
    }
  })
  const [preview, setPreview] = useState<ConfigWritePreviewResponse | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const parseConfig = (): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(text) as unknown
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
      setErr(T('config must be a JSON object'))
      return null
    } catch (e) {
      setErr(T('invalid JSON: {msg}', { msg: (e as Error).message }))
      return null
    }
  }

  const doPreview = async (): Promise<void> => {
    const cfg = parseConfig()
    if (!cfg) return
    setErr(null)
    try {
      setPreview(await patchJson<ConfigWritePreviewResponse>(`/api/plugins/${encodeURIComponent(name)}/config?dryRun=true`, { config: cfg }))
    } catch (e) {
      setErr(e instanceof ApiError ? T('preview failed: {msg}', { msg: e.detailMessage }) : String(e))
    }
  }

  const doApply = async (): Promise<void> => {
    const cfg = parseConfig()
    if (!cfg || !preview) return
    setErr(null)
    try {
      const r = await patchJson<ConfigWriteApplyResponse>(
        `/api/plugins/${encodeURIComponent(name)}/config?dryRun=false`,
        { config: cfg, yamlSha: preview.yamlSha },
      )
      setPreview(null)
      setApplied(T('applied — takes effect on the next nx-mk run (backup: {path})', { path: r.bakPath }))
    } catch (e) {
      // E5 常见态：提示重新 preview
      setErr(e instanceof ApiError ? T('apply failed: {msg} — re-preview and retry', { msg: e.detailMessage }) : String(e))
    }
  }

  return (
    <div className="section">
      <p className="empty">{T('config is JSON (valid YAML) for plugin {name}', { name })}</p>
      <textarea
        rows={8} cols={60} value={text}
        onChange={(e) => {
          setText(e.target.value)
          // W2 两段式确认门：改文即失效旧 preview——否则 doApply 会拿新 text 配旧 yamlSha 写盘
          setPreview(null)
        }}
      />
      <div>
        <button onClick={() => void doPreview()}>{T('Preview')}</button>{' '}
        <button onClick={() => void doApply()} disabled={preview === null}>{T('Apply')}</button>
      </div>
      {err ? <p className="error">{err}</p> : null}
      {preview ? (
        <div>
          <p className="empty">{T('preview diff (not written yet):')}</p>
          <pre>{preview.diff}</pre>
        </div>
      ) : null}
      {applied ? <p className="empty">{applied}</p> : null}
    </div>
  )
}
