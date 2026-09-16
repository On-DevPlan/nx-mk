/**
 * plugin-playwright 单测（spec §3.4）：
 * 通过 vi.mock('../src/runner.js') 隔离 playwright-core（浏览器永不加载），
 * mock 镜像真实契约 —— 向传入的共享 collector 投递 evidence 并返回描述符；
 * 插件侧编排（field-hit 直报 + snapshot 增量 → emitReport）走真实代码。
 * 另覆盖 beforeRun doctor 语义（collect 缺失静默 skip / chromium 不可用 fail-fast）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelError } from '@nx-mk/kernel'
import { createCollector } from '@nx-mk/client/collector'
import { createPlaywrightPlugin } from '../src/index.js'
import { toDescriptors } from '../src/scanner.js'

const EVAL_RESULT = [
  { dataMkField: 'data.id', visible: true, inViewport: true },
  { dataMkField: 'data.address.zip', visible: false, inViewport: false },
] as const

// —— mock runner：playwright-core 绝不在测试中加载；镜像 launchCollect 契约 ——
vi.mock('../src/runner.js', () => ({
  hasChromium: vi.fn(async () => true),
  launchCollect: vi.fn(async (_config, collector) => {
    for (const d of EVAL_RESULT) {
      collector.evidence({
        fieldPath: d.dataMkField,
        evidenceType: 'text',
        selector: `[data-mk-field="${d.dataMkField}"]`,
        visible: d.visible,
        inViewport: d.inViewport,
      })
    }
    return [...EVAL_RESULT]
  }),
}))

import { hasChromium } from '../src/runner.js'
const hasChromiumMock = vi.mocked(hasChromium)

interface Ctx {
  reports: Array<Record<string, unknown>>
  logger: { info: ReturnType<typeof vi.fn> }
  config: Record<string, unknown>
}

function makeCtx(overrides: Record<string, unknown> = {}): never {
  const reports: Array<Record<string, unknown>> = []
  return {
    reports,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: { collect: { url: 'http://localhost:5173' }, outputDir: '.nx-mk/runs' },
    cwd: '/tmp/x',
    kernel: { getSubcommand: () => 'run' },
    getTurn: () => 1,
    emitReport: (r: Record<string, unknown>) => { reports.push(r) },
    ...overrides,
  } as never
}

describe('scanner（page.evaluate 注入脚本 + 结构组装）', () => {
  it('PAGE_SCAN_SCRIPT 是可序列化字符串且读 [data-mk-field]', async () => {
    const { PAGE_SCAN_SCRIPT } = await import('../src/scanner.js')
    expect(typeof PAGE_SCAN_SCRIPT).toBe('string')
    expect(PAGE_SCAN_SCRIPT).toContain('data-mk-field')
    expect(PAGE_SCAN_SCRIPT).toContain('getBoundingClientRect')
  })

  it('toDescriptors：容忍畸形条目（过滤）并保留合法描述符', () => {
    const out = toDescriptors([
      { dataMkField: 'data.id', visible: true, inViewport: false },
      { junk: true },
      null,
      { dataMkField: 42 },
      { dataMkField: 'data.name', visible: false, inViewport: true },
    ])
    expect(out).toEqual([
      { dataMkField: 'data.id', visible: true, inViewport: false },
      { dataMkField: 'data.name', visible: false, inViewport: true },
    ])
    // 非数组输入 → 空数组（防御性）
    expect(toDescriptors(undefined)).toEqual([])
  })
})

describe('plugin hooks（mock browser）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hasChromiumMock.mockResolvedValue(true)
  })

  it('beforeRun(收集通路)：DOM 扫描 → collector evidence → emitReport(field-hit/endpoint-called)', async () => {
    const collector = createCollector()
    // 预置一条浏览器侧 trace（Task 7 接线前的占位信号）→ snapshot 产出 endpoint-called
    collector.trace({ requestId: 'r1', endpointId: 'ep1', method: 'GET', path: '/users' })
    const plugin = createPlaywrightPlugin({ url: 'http://localhost:5173', collector })
    const ctx = makeCtx()

    await plugin.hooks.beforeRun?.(ctx)

    // 扫描 evidence 已进入共享 collector（可被 drain→SQLite flush 消费）
    const drained = collector.drain()
    expect(drained.evidence).toHaveLength(2)
    expect(drained.evidence[0]).toMatchObject({
      fieldPath: 'data.id',
      evidenceType: 'text',
      selector: '[data-mk-field="data.id"]',
      visible: true,
      inViewport: true,
    })

    const { reports } = ctx as Ctx
    const kinds = new Set(reports.map((r) => r.kind))
    // 2 个扫描字段 → 2 个 field-hit；预置 trace → 1 个 endpoint-called
    expect(reports.filter((r) => r.kind === 'field-hit')).toEqual([
      { kind: 'field-hit', fieldId: 'data.id', count: 1, turn: 1 },
      { kind: 'field-hit', fieldId: 'data.address.zip', count: 1, turn: 1 },
    ])
    expect(reports.filter((r) => r.kind === 'endpoint-called')).toEqual([
      { kind: 'endpoint-called', method: 'GET', path: '/users', turn: 1 },
    ])
    expect(kinds.size).toBeGreaterThanOrEqual(2)
  })

  it('beforeRun：collect 配置缺失 → info 日志跳过（不抛）', async () => {
    const plugin = createPlaywrightPlugin({ url: 'http://localhost:5173' })
    const ctx = makeCtx({ config: { outputDir: '.nx-mk/runs' } })

    await expect(plugin.hooks.beforeRun?.(ctx)).resolves.toBeUndefined()
    expect((ctx as Ctx).logger.info).toHaveBeenCalledWith(
      expect.stringContaining('collect not configured'),
      expect.anything(),
    )
  })

  it('collect 配置存在但 chromium 不可用 → PLUGIN_HOOK_FAILED（提示 install 命令）', async () => {
    hasChromiumMock.mockResolvedValue(false)
    const plugin = createPlaywrightPlugin({})
    const ctx = makeCtx()

    const rejection = plugin.hooks.beforeRun?.(ctx)
    await expect(rejection).rejects.toBeInstanceOf(KernelError)
    await expect(rejection).rejects.toMatchObject({
      code: 'PLUGIN_HOOK_FAILED',
      message: expect.stringContaining('npx playwright install chromium'),
    })
  })
})
