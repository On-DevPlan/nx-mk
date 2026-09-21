/**
 * replayScenario 浏览器编排（spec S3/S7/S12 + SP4）+ trail 写盘（E9）：
 * 单 context+page 跑 runScenarioWithPage（无 observers —— replay 不进 coverage 通道，S7）；
 * E4 chromium 门（缺失/launch 失败 → ScenarioReplayError）；
 * trail 落 nxMkDir 下 replays/scenarios/<scenarioId>/<replayId>.json（mkdirSync recursive；失败静默 null，E9）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import type { Browser } from 'playwright-core'
import type { Scenario } from './dsl-schema.js'
import type { ScenarioRunResult, StepResult } from './runner.js'
import { hasChromium, runScenarioWithPage } from './playwright-runner.js'

export class ScenarioReplayError extends Error {
  constructor(readonly code: 'CHROMIUM_MISSING' | 'LAUNCH_FAILED', message: string) {
    super(message)
    this.name = 'ScenarioReplayError'
  }
}

export interface ScenarioReplayTrail {
  replayId: string
  scenarioId: string
  ok: boolean
  steps: StepResult[]
  createdAt: string
}

/** request replay 风格对齐：`<scenarioId>-<Date.now()>` */
export function makeScenarioReplayId(scenarioId: string): string {
  return `${scenarioId}-${Date.now()}`
}

/** 测试注入缝：launch 可替换（单测免真浏览器）；生产默认真 launch */
export const replayLaunch: { current: () => Promise<Browser> } = { current: () => chromium.launch() }

/** 单场景回放（spec S3/S7/S12）：read-only 步集无 observers；E4 chromium 门；SP4 浏览器生命周期内聚 */
export async function replayScenario(scenario: Scenario): Promise<ScenarioRunResult> {
  if (!(await hasChromium())) {
    throw new ScenarioReplayError('CHROMIUM_MISSING', 'chromium browser not available — run `npx playwright install chromium` first')
  }
  let browser: Browser
  try {
    browser = await replayLaunch.current()
  } catch (err) {
    throw new ScenarioReplayError('LAUNCH_FAILED', `chromium launch failed: ${(err as Error).message}`)
  }
  try {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      return await runScenarioWithPage(scenario, page)
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

/** trail 写盘：`<nxMkDir>/replays/scenarios/<scenarioId>/<replayId>.json`（nxMkDir 即 .nx-mk 目录，同 agent runtime 约定）；失败静默 null（E9） */
export function writeScenarioReplayTrail(nxMkDir: string, trail: ScenarioReplayTrail): string | null {
  const dir = join(nxMkDir, 'replays', 'scenarios', trail.scenarioId)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${trail.replayId}.json`), JSON.stringify(trail, null, 2), 'utf8')
    return trail.replayId
  } catch {
    return null
  }
}
