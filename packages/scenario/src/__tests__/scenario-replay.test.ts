/**
 * replayScenario 浏览器编排（SP4/E4）+ trail 写盘（S12/E9）。
 * chromium 不可达环境（CI/单测）下 CHROMIUM_MISSING 路径即可测——launch 路径以注入缝覆盖。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeScenarioReplayId, writeScenarioReplayTrail, replayScenario, replayLaunch, ScenarioReplayError, type ScenarioReplayTrail } from '../scenario-replay'
import { hasChromium } from '../playwright-runner'
import type { Scenario } from '../dsl-schema'
import type { ScenarioRunResult } from '../runner'
import type { Browser, Page } from 'playwright-core'

// 注入缝配套：hasChromium 打桩（launch 探针免真浏览器），其余导出保持真实实现
vi.mock('../playwright-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../playwright-runner')>()
  return { ...actual, hasChromium: vi.fn() }
})

function fakePage() {
  const page = {
    goto: async () => undefined,
    waitForSelector: async () => undefined,
    waitForRequest: async () => undefined,
    screenshot: async () => undefined,
  }
  return page as unknown as Page
}

function fakeBrowser() {
  const closed = { context: false, browser: false }
  const page = fakePage()
  const context = {
    newPage: async () => page,
    close: async () => {
      closed.context = true
    },
  }
  const browser = {
    newContext: async () => context,
    close: async () => {
      closed.browser = true
    },
  }
  return { browser: browser as unknown as Browser, closed }
}

describe('makeScenarioReplayId', () => {
  it('scenarioId-时间戳 形状', () => {
    expect(makeScenarioReplayId('s1')).toMatch(/^s1-\d+$/)
  })
})

describe('writeScenarioReplayTrail（S12/E9）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-srep-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('落 replays/scenarios/<scenarioId>/<replayId>.json 且内容 round-trip', () => {
    const trail: ScenarioReplayTrail = {
      replayId: makeScenarioReplayId('s1'),
      scenarioId: 's1',
      ok: true,
      steps: [{ stepId: 's1-step-0', type: 'goto', ok: true, durationMs: 5 }],
      createdAt: '2026-09-21T00:00:00.000Z',
    }
    expect(writeScenarioReplayTrail(dir, trail)).toBe(trail.replayId)
    const back = JSON.parse(readFileSync(join(dir, 'replays/scenarios/s1', `${trail.replayId}.json`), 'utf8')) as ScenarioReplayTrail
    expect(back.scenarioId).toBe('s1')
    expect(back.steps).toHaveLength(1)
  })

  it('E9：不可写路径 → null 不抛', () => {
    const blocker = join(dir, 'file-not-dir')
    writeFileSync(blocker, 'x', 'utf8')
    expect(writeScenarioReplayTrail(join(blocker, 'impossible'), {
      replayId: 'r', scenarioId: 's', ok: true, steps: [], createdAt: 'x',
    })).toBeNull()
  })

  it('同场景多次回放 → 同目录多文件互不覆盖', () => {
    const t1: ScenarioReplayTrail = { replayId: 's1-111', scenarioId: 's1', ok: true, steps: [], createdAt: 'x' }
    const t2: ScenarioReplayTrail = { replayId: 's1-222', scenarioId: 's1', ok: true, steps: [], createdAt: 'x' }
    writeScenarioReplayTrail(dir, t1)
    writeScenarioReplayTrail(dir, t2)
    expect(readdirSync(join(dir, 'replays/scenarios/s1'))).toHaveLength(2)
    expect(existsSync(join(dir, 'replays/scenarios/s1/s1-111.json'))).toBe(true)
  })
})

describe('replayScenario（E4 + 注入缝）', () => {
  const scen: Scenario = { id: 's1', name: 'n', steps: [{ type: 'goto', url: '/a' }, { type: 'screenshot' }] }
  const realLaunch = replayLaunch.current

  beforeEach(() => {
    vi.mocked(hasChromium).mockResolvedValue(true)
  })
  afterEach(() => {
    replayLaunch.current = realLaunch
    vi.mocked(hasChromium).mockReset()
  })

  it('E4：chromium 缺失 → ScenarioReplayError CHROMIUM_MISSING，且不触碰 launch', async () => {
    vi.mocked(hasChromium).mockResolvedValue(false)
    let launched = 0
    replayLaunch.current = () => {
      launched++
      return Promise.reject(new Error('should not launch'))
    }
    await expect(replayScenario(scen)).rejects.toBeInstanceOf(ScenarioReplayError)
    await expect(replayScenario(scen)).rejects.toMatchObject({ code: 'CHROMIUM_MISSING' })
    expect(launched).toBe(0)
  })

  it('launch 失败 → LAUNCH_FAILED', async () => {
    replayLaunch.current = async () => {
      throw new Error('boom')
    }
    await expect(replayScenario(scen)).rejects.toMatchObject({ code: 'LAUNCH_FAILED', message: 'chromium launch failed: boom' })
  })

  it('happy path：单 context+page 跑完步集，finally 关闭 context 与 browser', async () => {
    const fb = fakeBrowser()
    replayLaunch.current = async () => fb.browser
    const r: ScenarioRunResult = await replayScenario(scen)
    expect(r).toMatchObject({ scenarioId: 's1', ok: true })
    expect(r.steps).toHaveLength(2)
    expect(fb.closed).toEqual({ context: true, browser: true })
  })
})
