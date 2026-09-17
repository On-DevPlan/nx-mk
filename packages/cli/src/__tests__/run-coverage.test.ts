/**
 * run 命令 coverage 产物单测（spec §3.5，Task 8）：hermetic tmp fixture，
 * 沿 run-collect.test.ts 的 mock 模式（plugin-playwright 惰性 mock +
 * hoisted createKernel 部分 mock），不真跑浏览器。
 * - collect + coverage 段 → analyzer 跑通 → .nx-mk/coverage-report.json 落盘（三指标非零）
 * - stdout 三指标摘要行 + Report 路径
 * - kernel.run 返回 terminatedBy → endRun 落 runs.terminated_by（spec §3.1 审计链）
 * - report JSON 写失败仅 warn 不阻断（spec §4）
 * - manifest 缺失/形状非法 → 空报告产出（全零 metrics）+ warn，run 仍 completed
 *   （spec §4 错误处理表：审计链三产物不缺角；形状非法含审查 M1 的 `{}` 用例）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMain } from '../commands/run'
import { openCoverageDb } from '@nx-mk/coverage'
import { createCollector, type Collector } from '@nx-mk/client/collector'
import { createPlaywrightPlugin } from '@nx-mk/plugin-playwright'
import type { Plugin } from '@nx-mk/kernel'

// —— mock plugin-playwright：装配链路走真实 run.ts 代码，浏览器永不加载 ——
vi.mock('@nx-mk/plugin-playwright', () => ({
  createPlaywrightPlugin: vi.fn((_opts: { url: string; collector: Collector }): Plugin => ({
    name: '@nx-mk/plugin-playwright',
    version: '0.1.0',
    hooks: {},
  })),
}))

// —— 部分内核 mock：可注入 run() 返回 terminatedBy 的假内核（标志位于 hoisted 块），
// 其余导出透传原模块（makeRunId / KernelError 保持真实语义）——
const kernelMockState = vi.hoisted(() => ({ runTerminatedBy: undefined as string | undefined }))
vi.mock('@nx-mk/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx-mk/kernel')>()
  return {
    ...actual,
    createKernel: vi.fn((...args: Parameters<typeof actual.createKernel>) => {
      if (kernelMockState.runTerminatedBy !== undefined) {
        return {
          run: async () => ({
            runId: args[0]?.runId ?? 'run_fake',
            durationMs: 7,
            terminatedBy: kernelMockState.runTerminatedBy,
          }),
        } as unknown as ReturnType<typeof actual.createKernel>
      }
      return actual.createKernel(...(args as [never]))
    }) as unknown as typeof actual.createKernel,
  }
})

let workDir: string
let configPath: string
let dbPath: string
let reportPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-run-coverage-'))
  configPath = join(workDir, 'nx-mk.config.yml')
  dbPath = join(workDir, '.nx-mk', 'coverage.db')
  reportPath = join(workDir, '.nx-mk', 'coverage-report.json')
  writeFileSync(configPath, 'plugins: []\nlogLevel: info\n')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function silenceConsole(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'log').mockImplementation(() => {})
}
function spyWarn(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

// analyzer 门控输入 fixture：1 response 字段 data.name 的 manifest
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

function writeManifestFixture(): void {
  mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
  writeFileSync(join(workDir, '.nx-mk', 'manifest.json'), JSON.stringify(MANIFEST_1FIELD))
}

// collect + coverage 段配置 + 喂 r1/ep1/data.name 的 collector（hit + trace）
function fedCoverageCollector(): Collector {
  writeFileSync(
    configPath,
    "plugins: []\ncollect:\n  url: 'http://localhost:5173'\ncoverage:\n  required:\n    - 'data.name'\n",
  )
  const collector = createCollector()
  collector.trace({
    requestId: 'r1',
    endpointId: 'ep1',
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
  return collector
}

describe('runMain coverage 产物（spec §3.5）', () => {
  it('collect + coverage 段：run 后产出 coverage-report.json 且三指标非零', async () => {
    writeManifestFixture()
    const collector = fedCoverageCollector()
    const log = silenceConsole()
    const warn = spyWarn()
    try {
      await runMain({ configPath, runId: 'run_cov', cwd: workDir, collector })
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.runId).toBe('run_cov')
    expect(report.metrics.requiredCoverage).toBe(1)
    expect(report.metrics.effectiveCoverage).toBe(1)
    expect(report.metrics.rawBackendFieldCoverage).toBe(1)
    expect(report.metrics.fieldsTotal).toBe(1)
    // §28.2 requests 摘要随报告落盘（Task 7 审查裁定）
    expect(report.requests).toEqual([
      {
        requestId: 'r1',
        endpointId: 'ep1',
        method: 'GET',
        url: 'http://x/api/users',
        path: '/api/users',
        status: 200,
        durationMs: 5,
      },
    ])
  })

  it('run 摘要 stdout 含三指标行与 Report 路径', async () => {
    writeManifestFixture()
    const collector = fedCoverageCollector()
    const log = silenceConsole()
    const warn = spyWarn()
    let out = ''
    try {
      await runMain({ configPath, runId: 'run_sum', cwd: workDir, collector })
      out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    expect(out).toContain('Coverage: required 100%')
    expect(out).toContain('effective 100%')
    expect(out).toContain('raw backend 100%')
    expect(out).toContain('missing required: 0')
    expect(out).toContain('Report: .nx-mk/coverage-report.json')
  })

  it('kernel.run 返回 terminatedBy 时 endRun 落 runs.terminated_by（spec §3.1 审计链）', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    kernelMockState.runTerminatedBy = 'goal-met'
    const log = silenceConsole()
    const warn = spyWarn()
    try {
      await runMain({ configPath, runId: 'run_term', cwd: workDir })
    } finally {
      kernelMockState.runTerminatedBy = undefined
      log.mockRestore()
      warn.mockRestore()
    }
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT terminated_by FROM runs WHERE id = ?').get('run_term')).toEqual({
        terminated_by: 'goal-met',
      })
    } finally {
      db.close()
    }
  })

  it('report JSON 写失败仅 warn 不阻断（spec §4）', async () => {
    writeManifestFixture()
    const collector = fedCoverageCollector()
    // 预置为目录 → writeFileSync 报错 → warn 后 run 仍收尾成功
    mkdirSync(reportPath)
    const log = silenceConsole()
    const warn = spyWarn()
    let warnOut = ''
    try {
      await runMain({ configPath, runId: 'run_wf', cwd: workDir, collector })
      warnOut = warn.mock.calls.map((c) => String(c[0])).join('\n')
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    expect(warnOut).toContain('coverage-report.json write failed')
  })

  it('manifest 缺失 → 空报告产出（全零 metrics）+ warn，run 仍 completed（spec §4 错误处理表）', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    const collector = createCollector()
    collector.hit({
      requestId: 'r1',
      endpointId: 'ep1',
      fieldPath: 'data.name',
      normalizedPath: 'data.name',
      type: 'get',
      timestamp: Date.now(),
    })
    const log = silenceConsole()
    const warn = spyWarn()
    let warnOut = ''
    try {
      await runMain({ configPath, runId: 'run_nomanifest', cwd: workDir, collector })
      warnOut = warn.mock.calls.map((c) => String(c[0])).join('\n')
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    // warn 保留（不静默），但分析不跳过 —— 空报告照常落盘
    expect(warnOut).toContain('using empty manifest')
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.metrics).toEqual({
      requiredCoverage: 0,
      effectiveCoverage: 0,
      rawBackendFieldCoverage: 0,
      endpointsTotal: 0,
      endpointsCalled: 0,
      fieldsTotal: 0,
      fieldsReturned: 0,
      requiredFields: 0,
      missingRequiredFields: 0,
      ignoredReturnedFields: 0,
      suspiciousFields: 0,
    })
    expect(report.requests).toEqual([]) // 只喂了 hit 无 trace
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT status FROM runs').all()).toEqual([{ status: 'completed' }])
    } finally {
      db.close()
    }
  })

  it('manifest 形状非法（JSON 合法但无 fields/endpoints）→ 同样空报告 + warn + completed（审查 M1）', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    writeFileSync(join(workDir, '.nx-mk', 'manifest.json'), '{}')
    const collector = createCollector()
    collector.trace({ requestId: 'r9', method: 'GET', url: 'http://x/api/users', status: 200 })
    const log = silenceConsole()
    const warn = spyWarn()
    let warnOut = ''
    try {
      await runMain({ configPath, runId: 'run_badshape', cwd: workDir, collector })
      warnOut = warn.mock.calls.map((c) => String(c[0])).join('\n')
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    expect(warnOut).toContain('using empty manifest')
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.metrics.fieldsTotal).toBe(0)
    // traces 与 manifest 无关 → requests 摘要仍如实投影（§28.2）
    expect(report.requests).toEqual([{ requestId: 'r9', method: 'GET', url: 'http://x/api/users', status: 200 }])
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT status FROM runs').all()).toEqual([{ status: 'completed' }])
    } finally {
      db.close()
    }
  })
})
