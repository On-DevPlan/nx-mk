/**
 * playwright StepDriver 映射 + runScenarioWithPage observers 接线（SP5/SP6）。
 * mock page 只验证驱动调用形状；真浏览器链路由 T6/T7 的套件/回放集成覆盖。
 * runScenarioSuiteInBrowser 的 context 装配（SP10 initScripts 注入时序）用
 * mock chromium 验证 —— 不起真浏览器，只验 context 生命周期调用形状。
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createPlaywrightDriver, runScenarioWithPage, runScenarioSuiteInBrowser, type SuiteObservers } from '../playwright-runner'
import type { Scenario } from '../dsl-schema'
import type { Page } from 'playwright-core'

// —— mock chromium：context 记录 initScripts 与 newPage 调用序（SP10） ——
interface FakeSuitePage {
  goto: Mock<[], Promise<void>>
}
interface FakeSuiteCtx {
  initCalls: string[]
  addInitScript: Mock<[string], Promise<void>>
  newPage: Mock<[], Promise<FakeSuitePage>>
  close: Mock<[], Promise<void>>
}
vi.mock('playwright-core', () => {
  const registry: { contexts: FakeSuiteCtx[] } = { contexts: [] }
  const browser = {
    newContext: vi.fn(async () => {
      const ctx: FakeSuiteCtx = {
        initCalls: [],
        addInitScript: vi.fn(async (s: string) => { ctx.initCalls.push(s) }),
        newPage: vi.fn(async () => ({ goto: vi.fn(async () => {}) })),
        close: vi.fn(async () => {}),
      }
      registry.contexts.push(ctx)
      return ctx
    }),
    close: vi.fn(async () => {}),
  }
  return { chromium: { launch: vi.fn(async () => browser) }, __suiteRegistry: registry }
})

async function suiteRegistry(): Promise<{ contexts: FakeSuiteCtx[] }> {
  const pw = (await import('playwright-core')) as unknown as { __suiteRegistry: { contexts: FakeSuiteCtx[] } }
  return pw.__suiteRegistry
}

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

describe('runScenarioSuiteInBrowser — context 装配（SP10 initScripts）', () => {
  const scen = (id: string): Scenario => ({ id, name: id, steps: [{ type: 'goto', url: '/a' }] })

  beforeEach(async () => {
    vi.clearAllMocks()
    const { contexts } = await suiteRegistry()
    contexts.length = 0
  })

  it('initScripts 逐 context 全量注入，且先于 newPage（addInitScript 只对之后的页面生效）', async () => {
    const results = await runScenarioSuiteInBrowser([scen('s1'), scen('s2')], {
      concurrency: 1,
      initScripts: ['scriptA', 'scriptB'],
    })
    expect(results.map((r) => r.ok)).toEqual([true, true])
    const { contexts } = await suiteRegistry()
    expect(contexts).toHaveLength(2)
    for (const ctx of contexts) {
      expect(ctx.initCalls).toEqual(['scriptA', 'scriptB'])
      // 时序：init 全部落位后才 newPage
      expect(ctx.addInitScript.mock.invocationCallOrder[0]).toBeLessThan(ctx.newPage.mock.invocationCallOrder[0]!)
    }
  })

  it('initScripts 缺省 → 不触碰 addInitScript（既有路径零回归）', async () => {
    const results = await runScenarioSuiteInBrowser([scen('s1')], { concurrency: 1 })
    expect(results.map((r) => r.ok)).toEqual([true])
    const { contexts } = await suiteRegistry()
    expect(contexts).toHaveLength(1)
    expect(contexts[0]!.addInitScript).not.toHaveBeenCalled()
  })
})
