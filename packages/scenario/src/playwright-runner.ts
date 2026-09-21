/**
 * playwright-core 驱动（spec SP4/SP5/SP6）：
 * createPlaywrightDriver —— StepDriver 的 page 级实现（5 step 映射，legacy collect 同语义）。
 * runScenarioWithPage —— 单场景 + observers 接线（afterGoto=扫描缝 / afterStep=drain 缝）。
 * runScenarioSuiteInBrowser —— 单 browser 多 context 池（S10 并发真实实现）。
 * hasChromium 自 plugin-playwright 迁入（依赖方向 plugin-playwright → scenario，S4）。
 */
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import type { Scenario } from './dsl-schema.js'
import { runScenario, runScenarioSuite, type StepDriver, type ScenarioRunResult } from './runner.js'

/**
 * chromium 可用性探针（自 plugin-playwright/src/runner.ts 逐字迁移——迁移时以源文件现体为准）：
 * doctor 检查：尝试真实 launch 一次 headless chromium。
 * 缺浏览器二进制（npx playwright install 未执行）时 launch 会 reject → false。
 */
export async function hasChromium(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true })
    await browser.close()
    return true
  } catch {
    return false
  }
}

export const DEFAULT_STEP_TIMEOUT_MS = 15000

export function createPlaywrightDriver(page: Page): StepDriver {
  return {
    goto: (url) => page.goto(url, { waitUntil: 'networkidle' }).then(() => undefined),
    waitFor: (selector, timeoutMs) => page.waitForSelector(selector, { timeout: timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS }).then(() => undefined),
    // SP5：谓词 = URL 子串包含（零依赖、demo 粒度够用）
    waitForRequest: (urlPattern, timeoutMs) =>
      page.waitForRequest((u) => String(u).includes(urlPattern), { timeout: timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS }).then(() => undefined),
    assertFieldVisible: (field, timeoutMs) =>
      page.waitForSelector(`[data-mk-field="${field}"]`, { state: 'visible', timeout: timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS }).then(() => undefined),
    screenshot: (path) => page.screenshot(path !== undefined ? { path, fullPage: true } : { fullPage: true }).then(() => undefined),
    // 驱动自身无 drain 语义——真实 drain 由 runScenarioWithPage 的 observers 包装（SP6）
    drain: () => Promise.resolve(),
  }
}

export interface SuiteObservers {
  /** goto 完成后（plugin 侧：PAGE_SCAN → field-hit emitReport，SP6） */
  afterGoto?(scenarioId: string, page: Page, url: string): Promise<void>
  /** 每步 drain 时点（plugin 侧：drainBrowserCollector + 归因 tag，SP6） */
  afterStep?(scenarioId: string, tag: { scenarioId: string; dslStepId?: string }): Promise<void>
}

export async function runScenarioWithPage(scenario: Scenario, page: Page, observers?: SuiteObservers): Promise<ScenarioRunResult> {
  const inner = createPlaywrightDriver(page)
  const driver: StepDriver = {
    ...inner,
    goto: async (url) => {
      await inner.goto(url)
      if (observers?.afterGoto) await observers.afterGoto(scenario.id, page, url)
    },
    drain: async (tag) => {
      if (observers?.afterStep) await observers.afterStep(scenario.id, tag)
    },
  }
  return runScenario(scenario, driver)
}

export async function runScenarioSuiteInBrowser(
  scenarios: ReadonlyArray<Scenario>,
  opts: { concurrency: number; observers?: SuiteObservers },
): Promise<ScenarioRunResult[]> {
  const browser: Browser = await chromium.launch()
  try {
    return await runScenarioSuite(
      scenarios.map((scenario) => ({ scenario, ctx: 0 })),
      {
        concurrency: opts.concurrency,
        worker: async (item) => {
          const context = await browser.newContext()
          try {
            const page = await context.newPage()
            return await runScenarioWithPage(item.scenario, page, opts.observers)
          } finally {
            await context.close()
          }
        },
      },
    )
  } finally {
    await browser.close()
  }
}
