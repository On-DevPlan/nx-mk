/**
 * Scenario 纯逻辑执行（spec S6/S8/E5 + SP5/SP7）：
 * runScenario —— 步进 + 每步 drain 归因 + fail-fast（失败也 drain，失败步不带精确 stepId）。
 * runScenarioSuite —— 纯 worker 池调度（浏览器生命周期在 playwright-runner，SP4 分层）。
 */
import type { Scenario, ScenarioStep } from './dsl-schema.js'

export interface StepDriver {
  goto(url: string): Promise<void>
  waitFor(selector: string, timeoutMs?: number): Promise<void>
  waitForRequest(urlPattern: string, timeoutMs?: number): Promise<void>
  assertFieldVisible(field: string, timeoutMs?: number): Promise<void>
  screenshot(path?: string): Promise<void>
  /** 每步后由 runner 调用：plugin 侧 drainBrowserCollector + 归因打标（SP6） */
  drain(tag: { scenarioId: string; dslStepId?: string }): Promise<void>
}

export interface StepResult {
  stepId: string
  type: ScenarioStep['type']
  ok: boolean
  durationMs: number
  error?: string
}

export interface ScenarioRunResult {
  scenarioId: string
  ok: boolean
  steps: StepResult[]
}

/** SP2：显式 step id 优先，缺省 scenarioId-step-index */
export function stepIdOf(scenarioId: string, step: ScenarioStep, index: number): string {
  return step.id ?? `${scenarioId}-step-${index}`
}

export async function runScenario(scenario: Scenario, driver: StepDriver): Promise<ScenarioRunResult> {
  const steps: StepResult[] = []
  let ok = true
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]!
    const stepId = stepIdOf(scenario.id, step, i)
    const isWaitRequest = step.type === 'waitForRequest'
    const started = Date.now()
    let stepOk = true
    let error: string | undefined
    try {
      switch (step.type) {
        case 'goto':
          await driver.goto(step.url)
          break
        case 'waitFor':
          await driver.waitFor(step.selector, step.timeoutMs)
          break
        case 'waitForRequest':
          await driver.waitForRequest(step.urlPattern, step.timeoutMs)
          break
        case 'assertFieldVisible':
          await driver.assertFieldVisible(step.field, step.timeoutMs)
          break
        case 'screenshot':
          await driver.screenshot(step.path)
          break
      }
    } catch (err) {
      stepOk = false
      error = (err as Error).message
    }
    const result: StepResult = { stepId, type: step.type, ok: stepOk, durationMs: Date.now() - started, ...(error !== undefined ? { error } : {}) }
    steps.push(result)
    // SP5：waitForRequest 步 drain 带精确 dslStepId；SP7：失败步不带（失败时刻无法确认归因）
    if (!stepOk) {
      await driver.drain({ scenarioId: scenario.id })
      ok = false
      break
    }
    await driver.drain({ scenarioId: scenario.id, ...(isWaitRequest ? { dslStepId: stepId } : {}) })
  }
  return { scenarioId: scenario.id, ok, steps }
}

export interface SuiteItem<Ctx> {
  scenario: Scenario
  ctx: Ctx
}

export async function runScenarioSuite<Ctx>(
  items: ReadonlyArray<SuiteItem<Ctx>>,
  opts: { concurrency: number; worker: (item: SuiteItem<Ctx>) => Promise<ScenarioRunResult> },
): Promise<ScenarioRunResult[]> {
  const results = new Array<ScenarioRunResult>(items.length)
  let next = 0
  const concurrency = Math.max(1, Math.min(opts.concurrency, items.length))
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = next++
      if (idx >= items.length) return
      results[idx] = await opts.worker(items[idx]!)
    }
  })
  await Promise.all(workers)
  return results
}
