/**
 * /runs/:runId/requests/:requestId —— 请求详情三段（spec §3.4）：
 * trace / 关联 hits / 关联 evidence；空关联显示 "not associated"（v0 数据现实）。
 * 「响应值」区展示 trace.responsePreview（≤500 字符，采集侧截断；未记录显占位）。
 */
import { useState } from 'react'
import { ApiError, postJson } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { ReplayResponse, RequestDetailResponse } from '../../shared/api-types'

export function RequestDetailPage({ runId, requestId }: { runId: string; requestId: string }) {
  const T = useT()
  const { data, error } = usePolling<RequestDetailResponse>(`/api/runs/${runId}/requests/${requestId}`)
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">{T('Request not found: {id}', { id: requestId })}</p>
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  const t = data.trace
  /** 状态码着色：与 RequestsList 同一套语义（2xx 绿 / 3xx 琥珀 / 4xx+ 红） */
  const stCls = t.status == null ? '' : t.status < 300 ? 'st-ok' : t.status < 400 ? 'st-warn' : 'st-bad'
  return (
    <section>
      <h1>{t.method} {t.path ?? t.url}</h1>
      <p>
        <a href={`#/runs/${runId}/requests`}>{T('← Requests')}</a>
      </p>
      <table>
        <tbody>
          <tr><th>{T('url')}</th><td>{t.url}</td></tr>
          <tr><th>{T('status')}</th><td className={stCls}>{t.status ?? '—'}</td></tr>
          <tr><th>{T('duration')}</th><td>{t.durationMs != null ? `${t.durationMs}ms` : '—'}</td></tr>
          <tr><th>{T('endpoint')}</th><td>{t.endpointId ?? '—'}</td></tr>
          <tr><th>{T('started')}</th><td>{t.startedAt ?? '—'}</td></tr>
        </tbody>
      </table>
      <div className="section">
        <h2>{T('Response body')}</h2>
        {t.responsePreview != null
          ? <pre>{t.responsePreview}</pre>
          : <p className="empty">{T('not recorded')}</p>}
      </div>
      <CopyCurlSection method={t.method} url={t.url} />
      <ReplaySection runId={runId} requestId={requestId} />
      <div className="section">
        <h2>{T('Field hits')}</h2>
        {data.hits.length === 0 ? (
          <p className="empty">{T('not associated')}</p>
        ) : (
          <table>
            <thead><tr><th>{T('field')}</th><th>{T('count')}</th><th>{T('value state')}</th><th>{T('value type')}</th><th>{T('value hash')}</th><th>{T('source')}</th><th>{T('last hit')}</th></tr></thead>
            <tbody>
              {data.hits.map((h) => (
                <tr key={h.id}>
                  <td>{h.normalizedPath}</td>
                  <td>{h.count}</td>
                  <td>{h.valueState ?? '—'}</td>
                  <td>{h.valueType ?? '—'}</td>
                  <td><code>{h.valueHash ?? '—'}</code></td>
                  <td>{h.source ?? '—'}</td>
                  <td>{h.lastHitAt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="section">
        <h2>{T('UI evidence')}</h2>
        {data.evidence.length === 0 ? (
          <p className="empty">{T('not associated')}</p>
        ) : (
          <table>
            <thead><tr><th>{T('field')}</th><th>{T('visible')}</th><th>{T('text sample')}</th><th>{T('selector')}</th></tr></thead>
            <tbody>
              {data.evidence.map((e) => (
                <tr key={e.id}>
                  <td>{e.fieldPath}</td>
                  <td>{e.visible === 1 ? T('yes') : T('no')}</td>
                  <td>{e.textSample != null ? <pre>{e.textSample}</pre> : '—'}</td>
                  <td>{e.selector ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

/**
 * Copy curl（§22 Export DSL v0）：method+url 复刻为 curl 命令复制到剪贴板。
 * V3 裁定：trace 不存原始 body/headers —— curl 只含 method 与 URL，不臆造数据。
 */
function CopyCurlSection({ method, url }: { method: string; url: string }) {
  const T = useT()
  const [copied, setCopied] = useState(false)
  const curl = `curl -X ${method} '${url}'`
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(curl)
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 2000)
    } catch {
      /* 剪贴板不可用（非安全上下文等）——静默，按钮态不变 */
    }
  }
  return (
    <div className="section">
      <h2>{T('Copy curl')}</h2>
      <pre>{curl}</pre>
      <button onClick={() => void copy()}>{copied ? T('copied!') : T('Copy curl')}</button>
    </div>
  )
}

/**
 * Replay 行（spec §2.1）：按钮 → POST 无 confirm；409 → 显确认门（V4：idempotent/unsafe 同门）；
 * 403 → blocked 文案；200 → verdict 徽章 + status/duration/bodyPreview。
 * 交互流程由路由测试覆盖（node 渲染环境无事件模拟）；此处 UI 只渲染状态机输出。
 */
function ReplaySection({ runId, requestId }: { runId: string; requestId: string }) {
  const T = useT()
  const [result, setResult] = useState<ReplayResponse | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async (confirm: boolean): Promise<void> => {
    setBusy(true)
    setErrorText(null)
    try {
      const res = await postJson<ReplayResponse>(`/api/runs/${runId}/replay/request/${requestId}`, confirm ? { confirm: true } : {})
      setResult(res)
      setNeedsConfirm(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNeedsConfirm(true)
      } else if (err instanceof ApiError) {
        setErrorText(err.detailMessage)
      } else {
        setErrorText(T('replay request failed'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section">
      <h2>{T('Replay')}</h2>
      {result === null && !needsConfirm && (
        <button onClick={() => void send(false)} disabled={busy}>
          {T('Replay request')}
        </button>
      )}
      {needsConfirm && (
        <p className="error">
          {T('unsafe/idempotent method requires confirmation')}{' '}
          <button onClick={() => void send(true)} disabled={busy}>
            {T('Confirm replay')}
          </button>
        </p>
      )}
      {errorText !== null && <p className="error">{errorText}</p>}
      {result !== null && (
        <p>
          <span className="badge">{result.verdict}</span>{' '}
          {result.status === 'replay-error' ? (
            <span className="error">{T('replay-error: {err}', { err: result.error ?? 'network failure' })}</span>
          ) : (
            <>
              ok={String(result.ok)} status={result.status ?? '—'}
              {result.durationMs != null ? ` ${result.durationMs}ms` : ''}
            </>
          )}
          {result.bodyPreview !== null && <pre>{result.bodyPreview}</pre>}
        </p>
      )}
    </div>
  )
}
