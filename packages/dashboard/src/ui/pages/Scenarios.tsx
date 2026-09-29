/** /scenarios —— 场景列表 + Replay + 步骤级结果表（spec S3/S11/S12）+ 回放历史（DSL 驱动报告，含逐步 I/O 明细） */
import { useEffect, useState } from 'react'
import { ApiError, getJson, postJson } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { RunsListResponse, ScenariosResponse, ScenarioReplayResponse, ScenarioTrailDetailResponse, ScenarioTrailsResponse } from '../../shared/api-types'

/** 步骤级结果表：单独具名导出以便直测 */
export function ScenarioResult({ result }: { result: ScenarioReplayResponse }) {
  const T = useT()
  return (
    <div className="scenario-result">
      <p>
        <strong>{result.scenarioId}</strong> —{' '}
        {result.ok ? <span className="badge ok">{T('pass')}</span> : <span className="badge bad">{T('fail')}</span>}
        {result.trailWritten && <span> · {T('trail written')}</span>}
      </p>
      <table>
        <thead>
          <tr><th>{T('step')}</th><th>{T('type')}</th><th>{T('ok')}</th><th>{T('ms')}</th><th>{T('error')}</th></tr>
        </thead>
        <tbody>
          {result.steps.map((s) => (
            <tr key={s.stepId}>
              <td>{s.stepId}</td>
              <td>{s.type}</td>
              <td>{s.ok ? T('yes') : T('no')}</td>
              <td>{s.durationMs}</td>
              <td>{s.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 单条回放报告的 I/O 明细：挂载时拉 GET /api/scenarios/trails/:replayId（结果 × DSL 输入合并） */
export function TrailDetail({ replayId }: { replayId: string }) {
  const T = useT()
  const [data, setData] = useState<ScenarioTrailDetailResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setData(null)
    setErr(null)
    getJson<ScenarioTrailDetailResponse>('/api/scenarios/trails/' + encodeURIComponent(replayId))
      .then((d) => { if (alive) setData(d) })
      .catch((e: unknown) => { if (alive) setErr(e instanceof ApiError ? e.detailMessage : String(e)) })
    return () => { alive = false }
  }, [replayId])
  if (err !== null) return <p className="error">{T('error {code}: {detail}', { code: '—', detail: err })}</p>
  if (data === null) return <p className="loading">{T('loading…')}</p>
  return (
    <div className="scenario-result">
      {data.dslFile !== null && <p className="muted">DSL: {data.dslFile}</p>}
      <table>
        <thead>
          <tr><th>{T('step')}</th><th>{T('type')}</th><th>{T('input')}</th><th>{T('ok')}</th><th>{T('ms')}</th><th>{T('error')}</th></tr>
        </thead>
        <tbody>
          {data.steps.map((s) => (
            <tr key={s.stepId}>
              <td>{s.stepId}</td>
              <td>{s.type}</td>
              <td>{s.input === null ? <span className="muted">{T('n/a')}</span> : <code>{JSON.stringify(s.input)}</code>}</td>
              <td>{s.ok ? T('yes') : T('no')}</td>
              <td>{s.durationMs}</td>
              <td>{s.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 回放历史：replays/scenarios/**.json 的 DSL 驱动报告列表（只读扫描，形状门控在 server） */
export function ScenarioTrails() {
  const T = useT()
  const { data, error } = usePolling<ScenarioTrailsResponse>('/api/scenarios/trails')
  const [expanded, setExpanded] = useState<string | null>(null)
  if (error instanceof ApiError) {
    return <p className="error">{T('error {code}: {detail}', { code: error.status, detail: error.detailMessage })}</p>
  }
  if (!data) return <p className="loading">{T('loading…')}</p>
  // 防御：node 渲染测试的 usePolling mock 会把其它响应形状灌进来 → trails 缺省空数组
  const trails = data.trails ?? []
  if (trails.length === 0) return <p className="empty">{T('No scenario replays yet — click Replay above.')}</p>
  return (
    <table>
      <thead>
        <tr><th>{T('scenario')}</th><th>{T('status')}</th><th>{T('steps')}</th><th>{T('replayed at')}</th><th>{T('detail')}</th></tr>
      </thead>
      <tbody>
        {trails.map((t) => (
          <FragmentRow
            key={t.replayId}
            trail={t}
            expanded={expanded === t.replayId}
            onToggle={() => setExpanded(expanded === t.replayId ? null : t.replayId)}
            label={T('I/O')}
          />
        ))}
      </tbody>
    </table>
  )
}

/** 单行 + 展开明细行（key 需在 map 层，故拆具名组件） */
function FragmentRow({ trail, expanded, onToggle, label }: {
  trail: ScenarioTrailsResponse['trails'][number]
  expanded: boolean
  onToggle: () => void
  label: string
}) {
  const T = useT()
  return (
    <>
      <tr className="row-click" onClick={onToggle}>
        <td>{trail.scenarioId}</td>
        <td className={trail.ok ? 'st-ok' : 'st-bad'}>{trail.ok ? T('pass') : T('fail')}</td>
        <td>{trail.steps.filter((s) => s.ok).length}/{trail.steps.length}</td>
        <td>{trail.createdAt ?? '—'}</td>
        <td><span className="badge">{label}</span></td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5}>
            <TrailDetail replayId={trail.replayId} />
          </td>
        </tr>
      )}
    </>
  )
}

export function ScenariosPage() {
  const T = useT()
  const { data } = usePolling<ScenariosResponse>('/api/scenarios')
  const { data: runsData } = usePolling<RunsListResponse>('/api/runs')
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<ScenarioReplayResponse | null>(null)
  const [replayError, setReplayError] = useState<string | null>(null)

  const latestRunId = runsData?.runs[0]?.runId ?? null

  async function replay(id: string): Promise<void> {
    setRunning(id)
    setReplayError(null)
    try {
      const res = await postJson<ScenarioReplayResponse>(
        '/api/runs/' + encodeURIComponent(latestRunId!) + '/replay/scenario/' + encodeURIComponent(id),
        {},
      )
      setResult(res)
    } catch (err) {
      setReplayError(err instanceof ApiError ? `${err.status}: ${err.detailMessage}` : String(err))
    } finally {
      setRunning(null)
    }
  }

  if (!data) return <p className="loading">{T('loading…')}</p>
  if (!data.enabled) {
    return (
      <section>
        <h1>{T('Scenarios')}</h1>
        <p className="empty">{T('no scenarios configured — add a scenarios: include: section to nx-mk.config.yml.')}</p>
      </section>
    )
  }
  return (
    <section>
      <h1>{T('Scenarios')}</h1>
      {replayError && <p className="error">{T('replay failed — {msg}', { msg: replayError })}</p>}
      {data.scenarios.map((s) => {
        const busy = running === s.id
        return (
          <div key={s.id} className="scenario-card">
            <span className="badge">{s.id}</span> <strong>{s.name}</strong>
            {s.route && <span> · {s.route}</span>}
            <span> · {T('{n} steps', { n: s.stepCount })}</span>{' '}
            <button
              disabled={latestRunId === null || running !== null}
              title={latestRunId === null ? T('run once first') : undefined}
              onClick={() => void replay(s.id).then(() => undefined)}
            >
              {busy ? T('Replaying…') : T('Replay')}
            </button>
          </div>
        )
      })}
      {running && <p>{T('replaying {id}…', { id: running })}</p>}
      {result && <ScenarioResult result={result} />}
      <div className="section">
        <h2>{T('Replay history')}</h2>
        <ScenarioTrails />
      </div>
    </section>
  )
}
