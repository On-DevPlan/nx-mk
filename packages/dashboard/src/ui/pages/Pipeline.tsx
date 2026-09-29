/**
 * /runs/:runId/pipeline —— 流水线逐步报告页：
 * manifest 生成 → 插件加载 → goal-loop 轮次快照 → DSL 场景执行 → 分析报告 → 原始事件 I/O。
 * 数据源 GET /api/runs/:runId/pipeline（events.jsonl 聚合 + D12 门控报告）
 * 及 GET /api/runs/:runId/pipeline/events（原始事件逐条 I/O，展开时按需加载）。
 */
import { useState } from 'react'
import { ApiError, getJson } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { PipelineEventsResponse, PipelineReportResponse } from '../../shared/api-types'

function pct(n: number | null): string {
  return n === null ? '—' : `${Math.round(n * 100)}%`
}

/** 阶段名 → 展示键（en 原文即键，zh 词典补翻译） */
const PHASE_LABEL: Record<string, string> = {
  loadConfig: 'load config',
  resolvePlugins: 'resolve plugins',
  initPlugins: 'init plugins',
  run: 'collect & goal loop',
  shutdown: 'shutdown',
}

/** 原始事件 I/O 段：默认收起，展开时按需拉取 events.jsonl 逐条事件（行可展开看完整 JSON） */
function RawEvents({ runId }: { runId: string }) {
  const T = useT()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<PipelineEventsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  function toggle(): void {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (data !== null || err !== null) return // 已加载过不重复拉取
    getJson<PipelineEventsResponse>(`/api/runs/${encodeURIComponent(runId)}/pipeline/events`)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof ApiError ? e.detailMessage : String(e)))
  }

  if (!open) {
    return <p><button onClick={toggle}>{T('show raw events (I/O)')}</button></p>
  }
  return (
    <div>
      <p><button onClick={toggle}>{T('hide raw events')}</button></p>
      {err !== null && <p className="error">{T('error {code}: {detail}', { code: '—', detail: err })}</p>}
      {data !== null && (
        <>
          {data.truncated && <p className="muted">{T('truncated — showing first {n} events', { n: data.events.length })}</p>}
          <table>
            <thead><tr><th>{T('#')}</th><th>{T('type')}</th><th>{T('time')}</th><th>{T('payload')}</th></tr></thead>
            <tbody>
              {data.events.map((e, i) => (
                <tr key={i} className="row-click" onClick={() => setExpanded(expanded === i ? null : i)}>
                  <td>{i + 1}</td>
                  <td><span className="badge">{String(e.type)}</span></td>
                  <td>{typeof e.timestamp === 'string' ? e.timestamp : '—'}</td>
                  <td>
                    {expanded === i
                      ? <pre>{JSON.stringify(e, null, 2)}</pre>
                      : <span className="muted">{JSON.stringify(e).slice(0, 80)}{JSON.stringify(e).length > 80 ? '…' : ''}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export function PipelinePage({ runId }: { runId: string }) {
  const T = useT()
  const { data, error } = usePolling<PipelineReportResponse>(`/api/runs/${runId}/pipeline`)
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">{T('Run not found: {id}', { id: runId })}</p>
  }
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>

  const a = data.analysis
  return (
    <section>
      <h1>
        {T('Pipeline')} <span className="muted">({runId})</span>
        {data.goal !== null && (
          <span className={`badge ${data.goal.status === 'met' ? 'ok' : 'bad'}`}>
            {data.goal.status === 'met' ? T('goal met') : T('goal unmet')}
          </span>
        )}
      </h1>
      <p><a href={`#/runs/${runId}`}>{T('← Run')}</a></p>

      {/* 1. 阶段时间线 */}
      <div className="section">
        <h2>{T('Steps')}</h2>
        {data.phases === null ? (
          <p className="empty">{T('No events recorded for this run.')}</p>
        ) : (
          <table>
            <thead><tr><th>{T('step')}</th><th>{T('started')}</th><th>{T('duration')}</th></tr></thead>
            <tbody>
              {data.phases.map((p, i) => (
                <tr key={`${p.phase}-${i}`}>
                  <td>{T(PHASE_LABEL[p.phase] ?? p.phase)}</td>
                  <td>{p.startedAt ?? '—'}</td>
                  <td>{p.durationMs !== null ? `${p.durationMs}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.plugins.length > 0 && (
          <div className="counts">
            {data.plugins.map((p) => (
              <span key={p.name} className="badge">
                {p.name}{p.version !== null ? `@${p.version}` : ''}{p.state !== null ? ` · ${p.state}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 2. Manifest 步骤 */}
      {data.manifest !== null && (
        <div className="section">
          <h2>{T('Manifest')}</h2>
          <p>
            {T('{n} endpoints · {m} fields', { n: data.manifest.endpoints ?? 0, m: data.manifest.fields ?? 0 })}
            {data.manifest.sourceType !== null && <span className="muted"> · {data.manifest.sourceType}</span>}
            {data.manifest.version !== null && <span className="muted"> · v{data.manifest.version}</span>}
            {' '}
            <a href={`#/runs/${runId}/manifest`}>{T('Manifest browser')}</a>
          </p>
        </div>
      )}

      {/* 3. goal-loop 轮次快照 */}
      {data.turns.length > 0 && (
        <div className="section">
          <h2>{T('Coverage turns')}</h2>
          <table>
            <thead><tr><th>{T('turn')}</th><th>{T('coverage')}</th><th>{T('progress')}</th></tr></thead>
            <tbody>
              {data.turns.map((t) => (
                <tr key={t.turn}>
                  <td>#{t.turn}</td>
                  <td>{pct(t.ratio)}<span className="muted"> ({t.covered ?? '—'}/{t.total ?? '—'})</span></td>
                  <td>{t.progress ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.goal !== null && (
            <p className="muted">
              {T('terminated: {reason}', { reason: data.goal.status })}
              {data.goal.turns !== null ? ` · ${T('{n} turns', { n: data.goal.turns })}` : ''}
              {data.goal.durationMs !== null ? ` · ${data.goal.durationMs}ms` : ''}
            </p>
          )}
        </div>
      )}

      {/* 4. run 内 DSL 场景执行（scenario:start/done） */}
      {data.scenarios.length > 0 && (
        <div className="section">
          <h2>{T('Scenarios (in-run)')}</h2>
          <table>
            <thead><tr><th>{T('scenario')}</th><th>{T('ok')}</th></tr></thead>
            <tbody>
              {data.scenarios.map((s) => (
                <tr key={s.scenarioId}>
                  <td>{s.scenarioId}</td>
                  <td>{s.ok === null ? T('running…') : s.ok ? T('yes') : T('no')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. 分析报告（D12：仅最新 run 有） */}
      <div className="section">
        <h2>{T('Analysis report')}</h2>
        {a.hasReport ? (
          <>
            <div className="cards">
              <div className="card"><div className="num">{pct(a.requiredCoverage)}</div><div className="label">{T('required')}</div></div>
              <div className="card"><div className="num">{pct(a.effectiveCoverage)}</div><div className="label">{T('effective')}</div></div>
              <div className="card"><div className="num">{pct(a.rawBackendFieldCoverage)}</div><div className="label">{T('raw backend')}</div></div>
            </div>
            <p>
              <a href={`#/runs/${runId}/fields`}>{T('Fields →')}</a>
              {'　'}
              <a href={`#/runs/${runId}/requests`}>{T('Requests →')}</a>
            </p>
          </>
        ) : (
          <p className="empty">{T('No coverage report for this run (overwritten by the latest run).')}</p>
        )}
      </div>
      {/* 6. 原始事件逐条 I/O（按需加载，行展开看完整载荷） */}
      <div className="section">
        <h2>{T('Raw events (I/O)')}</h2>
        {data.phases === null ? (
          <p className="empty">{T('No events recorded for this run.')}</p>
        ) : (
          <RawEvents runId={runId} />
        )}
      </div>
    </section>
  )
}
