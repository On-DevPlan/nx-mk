/**
 * runScenario 纯逻辑（spec E5/S8/SP5/SP7）：步进顺序 / fail-fast / drain 归因 / 套件池调度。
 */
import { describe, it, expect } from 'vitest'
import { runScenario, runScenarioSuite, stepIdOf, type StepDriver, type ScenarioRunResult } from '../runner'
import type { Scenario } from '../dsl-schema'

/** 假驱动：记录调用序；可注入失败点与 drain 记录 */
function fakeDriver(failAt?: string): StepDriver & { calls: string[]; drains: Array<{ scenarioId: string; dslStepId?: string }> } {
  const calls: string[] = []
  const drains: Array<{ scenarioId: string; dslStepId?: string }> = []
  const step = async (name: string): Promise<void> => {
    calls.push(name)
    if (failAt === name) throw new Error(`boom: ${name}`)
  }
  return {
    calls,
    drains,
    goto: (url) => step(`goto:${url}`),
    waitFor: (s) => step(`waitFor:${s}`),
    waitForRequest: (p) => step(`waitForRequest:${p}`),
    assertFieldVisible: (f) => step(`assert:${f}`),
    screenshot: () => step('screenshot'),
    drain: (tag) => {
      drains.push(tag)
      return Promise.resolve()
    },
  }
}

const SCEN: Scenario = {
  id: 's1',
  name: 'n',
  steps: [
    { type: 'goto', url: '/a' },
    { type: 'waitFor', selector: '[x]' },
    { type: 'waitForRequest', urlPattern: '/api/a' },
    { type: 'assertFieldVisible', field: 'a.b' },
    { type: 'screenshot' },
  ],
}

describe('runScenario', () => {
  it('全绿：按序执行 5 步，每步后 drain；waitForRequest 步 drain 带精确 dslStepId（SP5）', async () => {
    const d = fakeDriver()
    const r = await runScenario(SCEN, d)
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true, true, true])
    expect(d.calls).toHaveLength(5)
    expect(d.drains).toHaveLength(5)
    expect(d.drains[2]).toEqual({ scenarioId: 's1', dslStepId: 's1-step-2' })
    expect(d.drains[0]).toEqual({ scenarioId: 's1' })
  })

  it('E5 fail-fast：第 3 步炸 → 后续不执行 + ok:false + SP7 失败也 drain', async () => {
    const d = fakeDriver('waitForRequest:/api/a')
    const r = await runScenario(SCEN, d)
    expect(r.ok).toBe(false)
    expect(r.steps).toHaveLength(3)
    expect(r.steps[2]!.ok).toBe(false)
    expect(r.steps[2]!.error).toContain('boom')
    expect(d.calls).toHaveLength(3)
    expect(d.drains).toHaveLength(3)
    // 失败步的 drain：无精确 stepId（SP7——失败时刻无法确认归因）
    expect(d.drains[2]).toEqual({ scenarioId: 's1' })
  })

  it('step id 显式提供时优先（SP2）', async () => {
    const d = fakeDriver()
    const scen: Scenario = { id: 's2', name: 'n', steps: [{ type: 'goto', url: '/x', id: 'open-x' }] }
    const r = await runScenario(scen, d)
    expect(r.steps[0]!.stepId).toBe('open-x')
  })
})

describe('stepIdOf（SP2）', () => {
  it('显式 id 优先，否则 scenarioId-step-index', () => {
    expect(stepIdOf('s', { type: 'goto', url: 'x', id: 'my-id' }, 3)).toBe('my-id')
    expect(stepIdOf('s', { type: 'goto', url: 'x' }, 3)).toBe('s-step-3')
  })
})

describe('runScenarioSuite（纯池调度）', () => {
  it('concurrency 限流 + 结果保持输入顺序', async () => {
    let inFlight = 0
    let peak = 0
    const r: ScenarioRunResult[] = await runScenarioSuite(
      [1, 2, 3, 4, 5].map((n) => ({ scenario: { ...SCEN, id: `s${n}` } as Scenario, ctx: n })),
      {
        concurrency: 2,
        worker: async (item) => {
          inFlight++
          peak = Math.max(peak, inFlight)
          await new Promise((res) => setTimeout(res, 5))
          inFlight--
          return { scenarioId: `s${item.ctx}`, ok: true, steps: [] }
        },
      },
    )
    expect(peak).toBeLessThanOrEqual(2)
    expect(r.map((x) => x.scenarioId)).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })
})
