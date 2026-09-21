/**
 * /scenarios 页渲染（S3/S11）：禁用态 / 场景列表 / 步骤级结果表（renderToString，v1 T6 先例——.ts 无 JSX → createElement）。
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

// usePolling 按 path 分流：'/' 请求（scenarios）与 '/api/runs'（回放门 runId 来源）
const pollImpl = vi.hoisted(() => ({ fn: undefined as unknown }))
vi.mock('../ui/hooks', () => ({
  usePolling: (path: string) => (pollImpl.fn as ((p: string) => unknown) | undefined)?.(path),
  useEventSource: () => ({ connected: false }),
}))

const { ScenariosPage, ScenarioResult } = await import('../ui/pages/Scenarios')

type PollState = { data: unknown; error: unknown; refresh: () => void }
function setStates(scenarios: unknown, runs: unknown): void {
  pollImpl.fn = (path: string): PollState => (path === '/api/runs'
    ? { data: runs, error: null, refresh: () => {} }
    : { data: scenarios, error: null, refresh: () => {} })
}

function render(el: ReturnType<typeof createElement>): string {
  return renderToString(el).replace(/<!-- -->/g, '')
}

describe('ScenariosPage', () => {
  it('disabled → 诚实空态引导文案', () => {
    setStates({ enabled: false, scenarios: [] }, { runs: [] })
    const html = render(createElement(ScenariosPage, {}))
    expect(html).toContain('no scenarios configured')
  })

  it('列表 → 场景卡（id/name/route/stepCount）+ Replay 按钮', () => {
    setStates(
      { enabled: true, scenarios: [{ id: 's-ok', name: 'ok 场景', route: '/users/1', stepCount: 2, file: 'mk/scenarios/s.yml' }] },
      { runs: [{ runId: 'run_a' }] },
    )
    const html = render(createElement(ScenariosPage, {}))
    expect(html).toContain('s-ok')
    expect(html).toContain('Replay')
    expect(html).toContain('/users/1')
  })

  it('无 runs → Replay 按钮禁用并提示先跑一次', () => {
    setStates(
      { enabled: true, scenarios: [{ id: 's-ok', name: 'ok 场景', stepCount: 2, file: 's.yml' }] },
      { runs: [] },
    )
    const html = render(createElement(ScenariosPage, {}))
    expect(html).toContain('run once first')
  })
})

describe('ScenarioResult', () => {
  it('结果 → 步骤表（stepId/type/ok/duration）', () => {
    const html = render(createElement(ScenarioResult, {
      result: {
        replayId: 'r1',
        scenarioId: 's-ok',
        ok: true,
        steps: [{ stepId: 's-ok-step-0', type: 'goto', ok: true, durationMs: 4 }],
        createdAt: 'x',
        trailWritten: true,
      },
    }))
    expect(html).toContain('s-ok-step-0')
    expect(html).toContain('goto')
    expect(html).toContain('trail')
  })

  it('失败步骤 → 显示 error 文案', () => {
    const html = render(createElement(ScenarioResult, {
      result: {
        replayId: 'r1',
        scenarioId: 's-ok',
        ok: false,
        steps: [{ stepId: 'st-1', type: 'get', ok: false, durationMs: 9, error: 'boom' }],
        createdAt: 'x',
        trailWritten: false,
      },
    }))
    expect(html).toContain('boom')
  })
})
