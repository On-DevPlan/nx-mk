/**
 * beforeRun 套件模式分叉（spec E2/E3/E8/S9/SP3/SP6）：
 * scenarios 配置门 / 0 命中回落 legacy collect / 归因 observers / 失败汇总。
 * suiteRunner 注入（SP4 缝）—— 测试不起真浏览器；mock 手法与包根
 * __tests__/plugin.test.ts 同源（vi.mock('../runner.js') 隔离 playwright-core，
 * loadScenarios 用真实现读 tmpdir YAML —— 纯 Node fs 无浏览器）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { createCollector } from '@nx-mk/client/collector'
import { createPlaywrightPlugin, type PlaywrightPluginOptions } from '../index.js'
import { COLLECTOR_SHIM_SCRIPT } from '../scanner.js'
import type { SuiteObservers, ScenarioRunResult, Scenario } from '@nx-mk/scenario'

const SCEN_YAML = `version: 1
scenarios:
  - id: s-ok
    name: ok
    steps:
      - type: goto
        url: /a
  - id: s-bad
    name: bad
    steps:
      - type: assertFieldVisible
        field: nope.missing
`

// —— mock runner：与 plugin.test.ts 同款 —— playwright-core 永不加载 ——
vi.mock('../runner.js', () => ({
  hasChromium: vi.fn(async () => true),
  launchCollect: vi.fn(async () => []),
}))

import { launchCollect } from '../runner.js'
const launchCollectMock = vi.mocked(launchCollect)

type SuiteRunner = NonNullable<PlaywrightPluginOptions['suiteRunner']>

interface SuiteCtx {
  reports: Array<Record<string, unknown>>
  emitted: Array<Record<string, unknown>>
  signals: Array<Record<string, unknown>>
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }
}

let dir = ''

function makeCtx(overrides: Record<string, unknown> = {}): never {
  const reports: Array<Record<string, unknown>> = []
  const emitted: Array<Record<string, unknown>> = []
  const signals: Array<Record<string, unknown>> = []
  return {
    reports,
    emitted,
    signals,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: { plugins: [], outputDir: '.nx-mk/runs' },
    cwd: dir,
    kernel: { getSubcommand: () => 'run' },
    getTurn: () => 1,
    emitReport: (r: Record<string, unknown>) => { reports.push(r) },
    emitSignal: (s: Record<string, unknown>) => { signals.push(s) },
    events: { emit: (e: Record<string, unknown>) => { emitted.push(e) } },
    ...overrides,
  } as never
}

describe('beforeRun 套件模式', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-suite-'))
    mkdirSync(join(dir, 'mk/scenarios'), { recursive: true })
    writeFileSync(join(dir, 'mk/scenarios/s.yml'), SCEN_YAML, 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('(a) scenarios.include 非空 → 注入 suiteRunner 被调：ids 正确 + concurrency 缺省 3 + scenario:start 先于执行', async () => {
    // 假 runner 记录被调时刻的事件数 —— 证明 start 全量 emit 先于 runner（S9 批次语义）
    let emittedAtRunnerCall = -1
    const suiteRunner = vi.fn(async (_scenarios: ReadonlyArray<Scenario>, _opts: { concurrency: number; observers: SuiteObservers }) => {
      emittedAtRunnerCall = emitted.length
      return [] as ScenarioRunResult[]
    })
    const plugin = createPlaywrightPlugin({ url: 'http://localhost:5173', suiteRunner: suiteRunner as SuiteRunner })
    const overrides = {
      config: { plugins: [], outputDir: '.nx-mk/runs', scenarios: { include: ['mk/scenarios/*.yml'] } },
    }
    const ctx = makeCtx(overrides)
    const { emitted } = ctx as SuiteCtx

    await plugin.hooks.beforeRun?.(ctx)

    expect(suiteRunner).toHaveBeenCalledOnce()
    const [scens, runOpts] = suiteRunner.mock.calls[0] as unknown as [
      Scenario[],
      { concurrency: number; observers: SuiteObservers; initScripts: ReadonlyArray<string> },
    ]
    expect(scens.map((s) => s.id)).toEqual(['s-ok', 's-bad'])
    expect(runOpts.concurrency).toBe(3)
    expect(typeof runOpts.observers.afterGoto).toBe('function')
    expect(typeof runOpts.observers.afterStep).toBe('function')
    // SP10：套件页必注入 collector shim（legacy Ruling 7 同通道）—— tmpdir 无
    // manifest → 不注 manifest shim，数组恰为单 collector shim；manifest 存在的
    // 顺序断言见下方 (a2)
    expect(runOpts.initScripts).toEqual([COLLECTOR_SHIM_SCRIPT])
    // start 两个场景均在 runner 调用前 emit（批次语义：start 全部 → 执行）
    expect(emittedAtRunnerCall).toBe(2)
    const starts = emitted.filter((e) => e.type === 'scenario:start')
    expect(starts.map((e) => e.scenarioId)).toEqual(['s-ok', 's-bad'])
    // 单次批次完成 → done 信号（Goal Loop all-done 早停的生产者侧）
    const { signals } = ctx as SuiteCtx
    expect(signals).toEqual([{ kind: 'done', reason: 'all-collected', turn: 1 }])
  })

  it('(a2) manifest 存在 → initScripts 先 manifest shim 后 collector shim + afterGoto 按 normalizedPath 集过滤', async () => {
    // 预置 manifest（plugin-swagger beforeRun 产物语义）—— 只登记 data.name
    mkdirSync(join(dir, '.nx-mk'), { recursive: true })
    writeFileSync(
      join(dir, '.nx-mk', 'manifest.json'),
      JSON.stringify({ version: '1', fields: [{ normalizedPath: 'data.name' }] }),
      'utf8',
    )
    const suiteRunner = vi.fn(async (_scenarios: ReadonlyArray<Scenario>, opts: { concurrency: number; observers: SuiteObservers }) => {
      // afterGoto：data.name 已知 → 直报；data.unknown 不在校验集 → 抑制
      const page = {
        evaluate: async () => [
          { dataMkField: 'data.name', visible: true, inViewport: true },
          { dataMkField: 'data.unknown', visible: true, inViewport: true },
        ],
      } as unknown as Page
      await opts.observers.afterGoto!('s-ok', page, '/a')
      return [] as ScenarioRunResult[]
    })
    const plugin = createPlaywrightPlugin({ url: 'http://localhost:5173', suiteRunner: suiteRunner as SuiteRunner })
    const ctx = makeCtx({
      config: { plugins: [], outputDir: '.nx-mk/runs', scenarios: { include: ['mk/scenarios/s.yml'] } },
    })

    await plugin.hooks.beforeRun?.(ctx)

    const [ , runOpts ] = suiteRunner.mock.calls[0] as unknown as [
      Scenario[],
      { initScripts: ReadonlyArray<string> },
    ]
    expect(runOpts.initScripts).toEqual([expect.stringContaining('__MK_MANIFEST__'), COLLECTOR_SHIM_SCRIPT])
    const { reports } = ctx as SuiteCtx
    expect(reports).toContainEqual({ kind: 'field-hit', fieldId: 'data.name', count: 1, turn: 1 })
    expect(reports.every((r) => r.kind !== 'field-hit' || r.fieldId !== 'data.unknown')).toBe(true)
  })

  it('(b) include 命中 0 文件 → suiteRunner 不被调 + warn 回落 legacy collect（collect.url 消费为证）', async () => {
    const suiteRunner = vi.fn(async () => [] as ScenarioRunResult[])
    const plugin = createPlaywrightPlugin({ url: 'http://localhost:5173', suiteRunner: suiteRunner as SuiteRunner })
    const ctx = makeCtx({
      config: {
        plugins: [],
        outputDir: '.nx-mk/runs',
        collect: { url: 'http://localhost:5173/legacy' },
        scenarios: { include: ['mk/scenarios-nonexistent/*.yml'] },
      },
    })

    await plugin.hooks.beforeRun?.(ctx)

    expect(suiteRunner).not.toHaveBeenCalled()
    expect((ctx as SuiteCtx).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('matched 0 files'),
    )
    // legacy 分支被走：mock 的 launchCollect 消费了 collect.url（E2 回落闭环）
    expect(launchCollectMock).toHaveBeenCalledOnce()
    expect(launchCollectMock.mock.calls[0]![0]).toMatchObject({ url: 'http://localhost:5173/legacy' })
  })

  it('(c) suiteRunner 返回 ok:false → E8 warn 汇总含失败 id + scenario:done(ok:false) 事件', async () => {
    const suiteRunner = vi.fn(async (scenarios: ReadonlyArray<Scenario>) =>
      scenarios.map((s): ScenarioRunResult => ({ scenarioId: s.id, ok: s.id === 's-ok', steps: [] })))
    const plugin = createPlaywrightPlugin({ url: 'http://localhost:5173', suiteRunner: suiteRunner as SuiteRunner })
    const ctx = makeCtx({
      config: { plugins: [], outputDir: '.nx-mk/runs', scenarios: { include: ['mk/scenarios/s.yml'] } },
    })

    await plugin.hooks.beforeRun?.(ctx)

    const { logger, emitted } = ctx as SuiteCtx
    // E8：失败汇总 warn（1/2 + 失败 id）；beforeRun 本身不抛（退出码不受影响）
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('1/2 scenarios failed'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('s-bad'))
    // S9：每个结果一个 scenario:done —— ok 标志逐场景如实
    const dones = emitted.filter((e) => e.type === 'scenario:done')
    expect(dones).toEqual([
      expect.objectContaining({ type: 'scenario:done', scenarioId: 's-ok', ok: true }),
      expect.objectContaining({ type: 'scenario:done', scenarioId: 's-bad', ok: false }),
    ])
  })

  it('(d) observers 归因闭环：afterStep drain 打 scenarioId 标进共享 collector + afterGoto 扫描直报 field-hit', async () => {
    // Node 环境镜像浏览器 shim：drain 脚本面向 window.__MK_COLLECTOR__（与
    // plugin.test.ts drain 测试同款手法 —— window 别名到 globalThis）
    ;(globalThis as Record<string, unknown>).window = globalThis
    const shim = {
      hits: [] as unknown[],
      traces: [
        { requestId: 'r_b', endpointId: 'ep1', method: 'GET', url: 'http://x/api/users', path: '/users', status: 200 },
      ],
      hit() {},
      trace() {},
    }
    ;(globalThis as Record<string, unknown>).__MK_COLLECTOR__ = shim
    try {
      let captured: { concurrency: number; observers: SuiteObservers } | undefined
      const suiteRunner = vi.fn(async (_scenarios: ReadonlyArray<Scenario>, opts: { concurrency: number; observers: SuiteObservers }) => {
        captured = opts
        return [] as ScenarioRunResult[]
      })
      const collector = createCollector()
      const plugin = createPlaywrightPlugin({ url: 'http://localhost:5173', collector, suiteRunner: suiteRunner as SuiteRunner })
      const ctx = makeCtx({
        config: { plugins: [], outputDir: '.nx-mk/runs', scenarios: { include: ['mk/scenarios/s.yml'] } },
      })

      await plugin.hooks.beforeRun?.(ctx)

      // —— afterStep（S6）：回捞页内 shim → 共享 collector trace 带 §26 归因标 ——
      const drainPage = { evaluate: async (fn: unknown) => (0, eval)(fn as string) } as unknown as Page
      await captured!.observers.afterStep!('s-ok', { scenarioId: 's-ok', dslStepId: 's-ok-step-0' }, drainPage)
      const drained = collector.drain()
      expect(drained.traces.some(
        (t) => t.requestId === 'r_b' && t.scenarioId === 's-ok' && t.dslStepId === 's-ok-step-0',
      )).toBe(true)
      // 回捞后页内缓冲已清空（增量不重复计数）
      expect(shim.traces).toHaveLength(0)

      // —— afterGoto（SP6）：DOM 扫描 → field-hit 直报 Goal Loop（空 field 过滤）——
      const scanPage = {
        evaluate: async () => [
          { dataMkField: 'data.id', visible: true, inViewport: true },
          { dataMkField: '', visible: true, inViewport: true },
        ],
      } as unknown as Page
      await captured!.observers.afterGoto!('s-ok', scanPage, '/a')
      const { reports } = ctx as SuiteCtx
      expect(reports).toContainEqual({ kind: 'field-hit', fieldId: 'data.id', count: 1, turn: 1 })
      expect(reports.every((r) => r.kind !== 'field-hit' || r.fieldId !== '')).toBe(true)
    } finally {
      delete (globalThis as Record<string, unknown>).__MK_COLLECTOR__
      delete (globalThis as Record<string, unknown>).window
    }
  })
})
