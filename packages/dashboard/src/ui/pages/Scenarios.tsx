/** /scenarios —— 场景列表 + Replay + 步骤级结果表（spec S3/S11/S12） */
import { useState } from 'react'
import { ApiError, postJson } from '../api'
import { usePolling } from '../hooks'
import { useT } from '../i18n'
import type { RunsListResponse, ScenariosResponse, ScenarioReplayResponse } from '../../shared/api-types'

/** 步骤级结果表：单独具名导出以便直测 */
export function ScenarioResult({ result }: { result: ScenarioReplayResponse }) {
  const T = useT()
  return (
    <div className="scenario-result">
      <p>
        <strong>{result.scenarioId}</strong> — {result.ok ? T('pass') : T('fail')}
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

  if (!data) return <p>{T('loading…')}</p>
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
    </section>
  )
}
