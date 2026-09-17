/**
 * run 命令 collect 装配单测（spec §3.6）：临时 fixture 项目（hermetic，不真跑 vite/browser）。
 * - collect 无配置 → 不建 coverage.db
 * - collect 配置 → run 结束后 coverage.db 存在（db path 指 tmp：经 cwd 注入）
 * - runs 表登记本次 run（insertRun → endRun completed）
 * - 注入的共享 collector 在 run 结束 flushDrained 落三表
 * - Ruling 5：collect 配置（无注入）→ 代码装配 plugin-playwright（共享 collector 喂插件 → flush 落库）
 * - collect.url 非 http(s) → CONFIG_INVALID fail-fast（spec §4）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMain } from '../commands/run'
import { openCoverageDb } from '@nx-mk/coverage'
import { createCollector, type Collector } from '@nx-mk/client/collector'
import { createPlaywrightPlugin } from '@nx-mk/plugin-playwright'
import type { Plugin } from '@nx-mk/kernel'

// —— mock plugin-playwright：装配链路走真实 run.ts 代码，浏览器永不加载 ——
// 基线实现返回惰性插件（不喂 collector）；装配用例用 mockImplementationOnce
// 镜像真实插件行为：向 run.ts 传入的共享 collector 投递浏览器通道回捞的数据。
vi.mock('@nx-mk/plugin-playwright', () => ({
  createPlaywrightPlugin: vi.fn((_opts: { url: string; collector: Collector }): Plugin => ({
    name: '@nx-mk/plugin-playwright',
    version: '0.1.0',
    hooks: {},
  })),
}))
const createPlaywrightPluginMock = vi.mocked(createPlaywrightPlugin)

// —— 终审 Important #1：createKernel 抛错路径 ——
// 部分内核 mock：createKernel 可开关抛错（标志位于 hoisted 块，模块工厂读取），
// 其余导出透传原模块（makeRunId / KernelError 保持真实语义）。
const kernelMockState = vi.hoisted(() => ({ throwOnCreate: false }))
vi.mock('@nx-mk/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx-mk/kernel')>()
  return {
    ...actual,
    createKernel: vi.fn((...args: Parameters<typeof actual.createKernel>) => {
      if (kernelMockState.throwOnCreate) throw new Error('kernel-boot-boom')
      return actual.createKernel(...(args as [never]))
    }) as unknown as typeof actual.createKernel,
  }
})

let workDir: string
let configPath: string
let dbPath: string
let reportPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-run-collect-'))
  configPath = join(workDir, 'nx-mk.config.yml')
  dbPath = join(workDir, '.nx-mk', 'coverage.db')
  reportPath = join(workDir, '.nx-mk', 'coverage-report.json')
  writeFileSync(configPath, 'plugins: []\nlogLevel: info\n')
  createPlaywrightPluginMock.mockClear()
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

// 收敛 console.log 静音（runMain 成功路径会打印运行摘要）
function silenceConsole(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'log').mockImplementation(() => {})
}

// I1（Task 7 审查）：collect 配置而 collector 未注入 → console.warn 一行
// （静默空 flush —— db 存在但三表全空 —— 是验收调试的时间黑洞）
function spyWarn(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

// —— Phase 3（spec §3.5）analyzer 输入 fixture：1 response 字段 data.name 的 manifest ——
// （Phase 2 用例给 manifest 使 analyzer 正常跑，不触发「manifest 缺失」skip warn）
const MANIFEST_1FIELD = {
  version: '1',
  source: { type: 'openapi', input: 'x.json', hash: 'h' },
  generatedAt: '',
  schemas: {},
  fields: [
    {
      id: 'h1',
      endpointId: 'ep1',
      direction: 'response',
      status: '200',
      path: 'data.name',
      normalizedPath: 'data.name',
      name: 'name',
      type: 'string',
      required: true,
      source: { openapiPointer: '' },
    },
  ],
  endpoints: [{ id: 'ep1', method: 'GET', path: '/api/users', responses: [{ status: '200', fields: [] }] }],
}

// 写 manifest fixture（analyzer 门控输入：缺失则跳过分析并 warn）
function writeManifestFixture(): void {
  mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
  writeFileSync(join(workDir, '.nx-mk', 'manifest.json'), JSON.stringify(MANIFEST_1FIELD))
}

describe('runMain collect 装配（spec §3.6）', () => {
  it('collect 缺失 → 不建 coverage.db；不产 coverage-report.json（行为不变回归）', async () => {
    const log = silenceConsole()
    try {
      await runMain({ configPath, runId: 'run_nodb', cwd: workDir })
    } finally {
      log.mockRestore()
    }
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(reportPath)).toBe(false)
  })

  it('collect 配置 → runs 表登记本次 run（insertRun → endRun completed，不带 terminatedBy）', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    writeManifestFixture() // 非 goal run → terminatedBy undefined → COALESCE 保留 NULL
    const log = silenceConsole()
    try {
      await runMain({ configPath, runId: 'run_db', cwd: workDir })
    } finally {
      log.mockRestore()
    }
    expect(existsSync(dbPath)).toBe(true)
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT id, status, ended_at, terminated_by FROM runs').all()).toEqual([
        { id: 'run_db', status: 'completed', ended_at: expect.any(String), terminated_by: null },
      ])
    } finally {
      db.close()
    }
  })

  it('run 结束后 coverage.db 文件存在于注入的 cwd（tmp）', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    const log = silenceConsole()
    const warn = spyWarn() // manifest 缺失 → analyzer skip warn（本用例不断言，静音）
    try {
      await runMain({ configPath, runId: 'run_file', cwd: workDir })
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    // db path 指 tmp：不存在于仓库 cwd，只存在于注入的 workDir
    expect(existsSync(dbPath)).toBe(true)
  })

  it('注入共享 collector → run 结束 flushDrained 落 field_hits/request_traces/ui_evidence', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    writeManifestFixture() // Phase 3：manifest 在场 → analyzer 正常跑（不触发 skip warn）
    const collector = createCollector()
    collector.trace({
      requestId: 'r1',
      method: 'GET',
      url: 'http://x/api/users',
      path: '/api/users',
      status: 200,
      durationMs: 5,
    })
    collector.hit({
      requestId: 'r1',
      endpointId: 'ep1',
      fieldPath: 'data.name',
      normalizedPath: 'data.name',
      type: 'get',
      timestamp: Date.now(),
    })
    collector.evidence({
      fieldPath: 'data.name',
      evidenceType: 'text',
      visible: true,
      inViewport: true,
    })
    const log = silenceConsole()
    const warn = spyWarn()
    let warnCount = -1
    try {
      await runMain({ configPath, runId: 'run_flush', cwd: workDir, collector })
      // 注意：mockRestore 会清空 mock.calls，先取计数再恢复
      warnCount = warn.mock.calls.length
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT count(*) AS n FROM field_hits').get()).toEqual({ n: 1 })
      expect(db.prepare('SELECT count(*) AS n FROM request_traces').get()).toEqual({ n: 1 })
      expect(db.prepare('SELECT count(*) AS n FROM ui_evidence').get()).toEqual({ n: 1 })
    } finally {
      db.close()
    }
    // 注入了 collector → 不触发「通道未接线」warn
    expect(warnCount).toBe(0)
  })

  it('Ruling 5 装配：collect 配置（无注入）→ 自建共享 collector 喂插件 → 产出经 flush 落库（不 warn）', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    writeManifestFixture() // Phase 3：manifest 在场 → analyzer 正常跑（不触发 skip warn）
    // 本次装配的插件镜像真实行为：beforeRun 向【run.ts 传入的共享 collector】投递
    // 浏览器通道回捞的 trace/evidence —— 断言同一实例最终被 flush 落库
    createPlaywrightPluginMock.mockImplementationOnce(
      (opts: { url: string; collector: Collector }): Plugin => ({
        name: '@nx-mk/plugin-playwright',
        version: '0.1.0',
        hooks: {
          beforeRun() {
            opts.collector.trace({
              requestId: 'r_asm',
              method: 'GET',
              url: 'http://x/api/users',
              path: '/api/users',
              status: 200,
              durationMs: 3,
            })
            opts.collector.evidence({
              fieldPath: 'data.id',
              evidenceType: 'text',
              visible: true,
              inViewport: true,
            })
          },
        },
      }),
    )
    const log = silenceConsole()
    const warn = spyWarn()
    let warnCount = -1
    try {
      await runMain({ configPath, runId: 'run_asm', cwd: workDir })
      warnCount = warn.mock.calls.length
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    // 工厂被调用且 url 来自 collect.url（插件选项回退）
    expect(createPlaywrightPluginMock).toHaveBeenCalledTimes(1)
    expect(createPlaywrightPluginMock.mock.calls[0]?.[0]).toMatchObject({
      url: 'http://localhost:5173',
    })
    // I1 语义演进：Ruling 5 装配后 flush 通道已接线 → 不触发 warn
    expect(warnCount).toBe(0)
    // 同一 collector 实例：插件喂的数据经 runMain flush 落库
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT count(*) AS n FROM request_traces').get()).toEqual({ n: 1 })
      expect(db.prepare('SELECT count(*) AS n FROM ui_evidence').get()).toEqual({ n: 1 })
    } finally {
      db.close()
    }
  })

  it('collect 缺失 → 不装配 plugin-playwright（动态 import 不触发）', async () => {
    const log = silenceConsole()
    try {
      await runMain({ configPath, runId: 'run_noasm', cwd: workDir })
    } finally {
      log.mockRestore()
    }
    expect(createPlaywrightPluginMock).not.toHaveBeenCalled()
  })

  it('collect.url 非 http(s) → CONFIG_INVALID 且不建 db', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'ftp://example.com'\n")
    await expect(
      runMain({ configPath, runId: 'run_badurl', cwd: workDir }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    expect(existsSync(dbPath)).toBe(false)
  })

  // —— 终审 Important #1：createKernel 位于 try 内（内核构造抛错也走失败收尾）——
  it('createKernel 抛错 → runs 行标 failed + db 关闭（finally）+ 原始错误上抛', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    kernelMockState.throwOnCreate = true
    let thrown: unknown
    try {
      await runMain({ configPath, runId: 'run_kernelboom', cwd: workDir })
    } catch (err) {
      thrown = err
    } finally {
      kernelMockState.throwOnCreate = false
    }
    expect((thrown as Error)?.message).toBe('kernel-boot-boom')
    // 实现里 finally { db?.close() }：若句柄未关，Windows 上重新 open 同一文件
    // 会因独占锁报 SQLITE_BUSY —— 成功 open 即证明已关闭
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT id, status FROM runs').all()).toEqual([
        { id: 'run_kernelboom', status: 'failed' },
      ])
    } finally {
      db.close()
    }
  })
})
