/**
 * /settings/plugins —— 插件配置只读 + YAML 片段（spec U3/R6-R8）。
 * stale → 「kernel 未产出清单」提示（E4）；无 schema → 「No schema exposed」（R8）；
 * 复制按钮走 navigator.clipboard（node 渲染环境不触发，浏览器生效）。
 */
import { useState } from 'react'
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { yamlSnippet } from '../yaml-snippet'
import type { PluginEntryView, PluginsResponse } from '../../shared/api-types'

export function PluginSettingsPage() {
  const { data, error } = usePolling<PluginsResponse>('/api/plugins')
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">Plugins endpoint not found.</p>
  }
  if (error instanceof ApiError) return <p className="error">error {error.status}: {error.detailMessage}</p>
  if (!data) return <p>loading…</p>
  if (data.stale) {
    return (
      <section>
        <h1>Plugins</h1>
        <p className="empty">kernel has not produced plugins-manifest.json yet — run once first.</p>
      </section>
    )
  }
  return (
    <section>
      <h1>Plugins</h1>
      <p className="empty">read-only — YAML snippets are for reference; write-back lands in v1.</p>
      {data.plugins.map((p) => (
        <PluginCard key={p.name} entry={p} />
      ))}
    </section>
  )
}

function PluginCard({ entry }: { entry: PluginEntryView }) {
  const [copied, setCopied] = useState(false)
  const snippet = yamlSnippet(entry)
  return (
    <div className="section">
      <h2>
        {entry.name} <span className="badge">v{entry.version}</span>{' '}
        {entry.enabled ? <span className="badge">enabled</span> : null}
      </h2>
      {entry.configSchema === null ? <p className="empty">No schema exposed</p> : null}
      <pre>{snippet}</pre>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(snippet).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied!' : 'Copy YAML'}
      </button>
    </div>
  )
}