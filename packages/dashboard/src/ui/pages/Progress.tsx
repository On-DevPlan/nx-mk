/**
 * /progress（进度 tab 首页）—— 五相时间线 + 当前报告卡片 + 子页入口（3-tab 重构）。
 * 数据全部复用既有路由：/api/runs → 最新 run；/api/runs/:id/pipeline → 五相 I/O；
 * /api/runs/:id/metrics → 覆盖率报告卡片。旧 Overview 页保留（#/overview 直达）。
 * 页面只做「拉数 → 渲染」，状态机由 usePolling 承担（P4 模式）。
 */import { useEventSource, usePolling } from '../hooks'
import { useT } from '../i18n'
import type { RunsListResponse, MetricsResponse, PipelineReportResponse } from '../../shared/api-types'

/** 五相固定顺序（kernel Phase 全集；pipeline 数据缺失时也渲染骨架） */
const PHASES = ['loadConfig', 'resolvePlugins', 'initPlugins', 'run', 'shutdown'] as const

function pctText(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function ProgressPage() {
  const T = useT()
  useEventSource('/api/events')
  const { data: runsData, error } = usePolling<RunsListResponse>('/api/runs')
  const latest = runsData?.runs.find((r) => r.hasReport) ?? null
  const pipeline = usePolling<PipelineReportResponse>(latest ? `/api/runs/${encodeURIComponent(latest.runId)}/pipeline` : null)
  const metrics = usePolling<MetricsResponse>(latest ? `/api/runs/${encodeURIComponent(latest.runId)}/metrics` : null)

  if (error !== null) {
    return <section><h1>{T('Progress')}</h1><p className="error">{T('failed to load runs')}</p></section>
  }
  if (runsData === null) {
    return <section><h1>{T('Progress')}</h1><p className="loading">{T('loading…')}</p></section>
  }
  if (latest === null) {
    return (
      <section>
        <h1>{T('Progress')}</h1>
        <p className="empty">{T('No runs yet — run {cmd} first.', { cmd: 'nx-mk run' })}</p>
      </section>
    )
  }

  const phaseMap = new Map((pipeline.data?.phases ?? []).map((p) => [p.phase, p]))
  const m = metrics.data?.metrics ?? null

  return (
    <section>
      <h1>{T('Progress')}</h1>
      <div className="section">
        <h2>{T('Report')}</h2>
        <table>
          <tbody>
            <tr><th>{T('run')}</th><td><a href={`#/runs/${encodeURIComponent(latest.runId)}`}>{latest.runId}</a></td></tr>
            <tr><th>{T('terminated')}</th><td>{metrics.data?.terminatedBy ?? latest.terminatedBy ?? '—'}</td></tr>
            <tr><th>{T('coverage')}</th><td>{m !== null ? pctText(m.requiredCoverage) : '—'}</td></tr>
            <tr><th>{T('missing (summary)')}</th><td>{m !== null ? `missing ${m.missingRequiredFields} / suspicious ${m.suspiciousFields} / ignored ${m.ignoredReturnedFields}` : '—'}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="section">
        <h2>{T('Phases')}</h2>
        <table>
          <thead>
            <tr><th>#</th><th>{T('phase')}</th><th>{T('duration')}</th><th>{T('details')}</th></tr>
          </thead>
          <tbody>
            {PHASES.map((phase, i) => {
              const st = phaseMap.get(phase)
              return (
                <tr key={phase}>
                  <td>{i + 1}</td>
                  <td>{phase}</td>
                  <td>{st?.durationMs !== null && st?.durationMs !== undefined ? `${st.durationMs} ms` : '—'}</td>
                  <td>
                    {phase === 'run' && latest.runId ? <a href={`#/runs/${encodeURIComponent(latest.runId)}/pipeline`}>{T('Pipeline →')}</a> : <span>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="section">
        <h2>{T('Sub pages')}</h2>
        <p>
          <a href={`#/runs/${encodeURIComponent(latest.runId)}/pipeline`}>{T('Pipeline →')}</a>{' · '}
          <a href="#/scenarios">{T('Scenarios')} →</a>{' · '}
          <a href={`#/runs/${encodeURIComponent(latest.runId)}/agent`}>{T('Agent Loop')} →</a>{' · '}
          <a href={`#/runs/${encodeURIComponent(latest.runId)}`}>{T('Overview')} →</a>
        </p>
      </div>
    </section>
  )
}
