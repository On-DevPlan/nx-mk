/**
 * playwright StepDriver 映射 + runScenarioWithPage observers 接线（SP5/SP6）。
 * mock page 只验证驱动调用形状；真浏览器链路由 T6/T7 的套件/回放集成覆盖。
 */
import { describe, it, expect } from 'vitest'
import { createPlaywrightDriver, runScenarioWithPage, type SuiteObservers } from '../playwright-runner'
import type { Scenario } from '../dsl-schema'
import type { Page } from 'playwright-core'

function fakePage() {
  const calls: Array<{ op: string; args: unknown[] }> = []
  const page = {
    goto: async (url: string, o?: unknown) => {
      calls.push({ op: 'goto', args: [url, o] })
    },
    waitForSelector: async (sel: string, o?: unknown) => {
      calls.push({ op: 'waitForSelector', args: [sel, o] })
    },
    waitForRequest: async (pred: unknown, o?: unknown) => {
      calls.push({ op: 'waitForRequest', args: [pred, o] })
    },
    screenshot: async (o?: unknown) => {
      calls.push({ op: 'screenshot', args: [o] })
    },
  }
  return { page: page as unknown as Page, calls }
}

describe('createPlaywrightDriver（5 step 映射）', () => {
  it('goto 带 networkidle；waitFor 缺省 15000ms', async () => {
    const { page, calls } = fakePage()
    const d = createPlaywrightDriver(page)
    await d.goto('/a')
    await d.waitFor('[x]')
    expect(calls[0]).toEqual({ op: 'goto', args: ['/a', { waitUntil: 'networkidle' }] })
    expect(calls[1]!.args[1]).toEqual({ timeout: 15000 })
  })

  it('waitForRequest 谓词 = String(url).includes(urlPattern)（SP5）', async () => {
    const { page, calls } = fakePage()
    const d = createPlaywrightDriver(page)
    await d.waitForRequest('/api/users', 3000)
    const { op, args } = calls[0]!
    expect(op).toBe('waitForRequest')
    const pred = args[0] as (u: unknown) => boolean
    expect(pred({ toString: () => 'http://x/api/users/1' })).toBe(true)
    expect(pred({ toString: () => 'http://x/api/orders' })).toBe(false)
    expect(args[1]).toEqual({ timeout: 3000 })
  })

  it('assertFieldVisible 定位 data-mk-field + state visible', async () => {
    const { page, calls } = fakePage()
    const d = createPlaywrightDriver(page)
    await d.assertFieldVisible('user.name')
    expect(calls[0]!.args[0]).toBe('[data-mk-field="user.name"]')
    expect(calls[0]!.args[1]).toEqual({ state: 'visible', timeout: 15000 })
  })
})

describe('runScenarioWithPage（SP6 observers 接线）', () => {
  it('goto 后 afterGoto / 每步后 afterStep 带 tag；waitForRequest 精确 stepId', async () => {
    const { page } = fakePage()
    const gotos: string[] = []
    const tags: Array<{ scenarioId: string; dslStepId?: string }> = []
    const observers: SuiteObservers = {
      afterGoto: async (_sid, _page, url) => {
        gotos.push(url)
      },
      afterStep: async (_sid, tag) => {
        tags.push(tag)
      },
    }
    const scen: Scenario = {
      id: 's',
      name: 'n',
      steps: [{ type: 'goto', url: '/a' }, { type: 'waitForRequest', urlPattern: '/api' }],
    }
    const r = await runScenarioWithPage(scen, page, observers)
    expect(r.ok).toBe(true)
    expect(gotos).toEqual(['/a'])
    expect(tags[1]).toEqual({ scenarioId: 's', dslStepId: 's-step-1' })
  })

  it('无 observers → 全程 no-op 照常跑通（replay 路径）', async () => {
    const { page } = fakePage()
    const scen: Scenario = { id: 's', name: 'n', steps: [{ type: 'goto', url: '/a' }, { type: 'screenshot' }] }
    const r = await runScenarioWithPage(scen, page)
    expect(r.ok).toBe(true)
  })
})
