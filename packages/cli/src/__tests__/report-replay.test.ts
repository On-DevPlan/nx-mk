/**
 * C4（§9 对齐）：report / replay 子命令。
 * report：产物缺失 → RUN_NOT_FOUND；摘要打印 + --open 注入缝。
 * replay request：GET 复刻（fetch mock）+ 留痕落盘；POST 无 --confirm → KERNEL_INTERNAL；
 * 敏感路径 → RUN_NOT_FOUND（blocked 同源语义）；未知 requestId → RUN_NOT_FOUND。
 * replay scenario：scenarios.include 缺失 → CONFIG_INVALID；未知 id → RUN_NOT_FOUND。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reportMain } from '../commands/report.js'
import { replayMain } from '../commands/replay.js'

let workDir: string
let configPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-report-replay-'))
  configPath = join(workDir, 'nx-mk.config.yml')
  writeFileSync(configPath, 'plugins: []\n')
})
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function writeReportFile(requests: { requestId: string; method: string; url: string }[]): void {
  mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
  writeFileSync(
    join(workDir, '.nx-mk', 'coverage-report.json'),
    JSON.stringify({
      runId: 'run_x',
      metrics: { requiredCoverage: 0.5, effectiveCoverage: 0.75, rawBackendFieldCoverage: 0.6, fieldsTotal: 10, fieldsReturned: 6, missingRequiredFields: 1, ignoredReturnedFields: 2, suspiciousFields: 0, endpointsTotal: 2, endpointsCalled: 1 },
      requests,
    }),
    'utf8',
  )
}

describe('report 子命令（C4）', () => {
  it('报告缺失 → RUN_NOT_FOUND（退出码 2 语义）', async () => {
    await expect(reportMain({ cwd: workDir })).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })
  it('报告存在 → 打印三指标摘要与产物路径', async () => {
    writeReportFile([])
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => logs.push(a.join(' ')))
    try {
      await reportMain({ cwd: workDir })
    } finally {
      spy.mockRestore()
    }
    const all = logs.join('\n')
    expect(all).toContain('required 50%')
    expect(all).toContain('effective 75%')
    expect(all).toContain('coverage.db')
    expect(all).toContain('missing required: 1')
  })
  it('--open 走注入缝打开报告文件', async () => {
    writeReportFile([])
    const opened: string[] = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await reportMain({ cwd: workDir, open: true, deps: { openPath: (p) => opened.push(p) } })
    } finally {
      vi.restoreAllMocks()
    }
    expect(opened).toHaveLength(1)
    expect(opened[0]).toContain('coverage-report.json')
  })
})

describe('replay request 子命令（C4）', () => {
  it('未知 requestId → RUN_NOT_FOUND', async () => {
    writeReportFile([{ requestId: 'r1', method: 'GET', url: 'http://api.local/a' }])
    await expect(
      replayMain({ kind: 'request', args: ['run_x', 'nope'], configPath, cwd: workDir }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })
  it('敏感路径 → RUN_NOT_FOUND（blocked，与 dashboard 同源分类）', async () => {
    writeReportFile([{ requestId: 'r2', method: 'GET', url: 'http://api.local/payment/9' }])
    await expect(
      replayMain({ kind: 'request', args: ['run_x', 'r2'], configPath, cwd: workDir }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', message: expect.stringContaining('blocked') })
  })
  it('POST 未 --confirm → KERNEL_INTERNAL 提示确认', async () => {
    writeReportFile([{ requestId: 'r3', method: 'POST', url: 'http://api.local/orders' }])
    await expect(
      replayMain({ kind: 'request', args: ['run_x', 'r3'], configPath, cwd: workDir }),
    ).rejects.toMatchObject({ code: 'KERNEL_INTERNAL', message: expect.stringContaining('--confirm') })
  })
  it('GET → fetch 复刻 + 留痕落 .nx-mk/replays/<runId>/', async () => {
    writeReportFile([{ requestId: 'r1', method: 'GET', url: 'http://api.local/a' }])
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await replayMain({ kind: 'request', args: ['run_x', 'r1'], configPath, cwd: workDir })
    } finally {
      spy.mockRestore()
    }
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.local/a')
    const replayDir = join(workDir, '.nx-mk', 'replays', 'run_x')
    expect(existsSync(replayDir)).toBe(true)
    const file = readdirSync(replayDir)[0]
    expect(file).toBeTruthy()
    const trail = JSON.parse(readFileSync(join(replayDir, file ?? ''), 'utf8')) as { requestId: string; verdict: string }
    expect(trail.requestId).toBe('r1')
    expect(trail.verdict).toBe('safe')
  })
  it('config replay.block 命中 → blocked（C3 规则进 CLI 复刻）', async () => {
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    writeFileSync(
      join(workDir, '.nx-mk', 'coverage-report.json'),
      JSON.stringify({ requests: [{ requestId: 'r9', method: 'GET', url: 'http://api.local/api/vault/1' }] }),
      'utf8',
    )
    writeFileSync(configPath, 'plugins: []\nreplay:\n  block:\n  - pattern: "/api/vault/**"\n')
    await expect(
      replayMain({ kind: 'request', args: ['run_x', 'r9'], configPath, cwd: workDir }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', message: expect.stringContaining('/api/vault/**') })
  })
})

describe('replay scenario 子命令（C4）', () => {
  it('scenarios.include 缺失 → CONFIG_INVALID', async () => {
    await expect(
      replayMain({ kind: 'scenario', args: ['user-profile'], configPath, cwd: workDir }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })
  it('未知 scenario id → RUN_NOT_FOUND（场景解析先于浏览器启动）', async () => {
    mkdirSync(join(workDir, 'mk', 'scenarios'), { recursive: true })
    writeFileSync(
      join(workDir, 'mk', 'scenarios', 'a.yml'),
      'scenarios:\n  - id: known\n    steps:\n      - type: goto\n        url: http://local/x\n',
      'utf8',
    )
    writeFileSync(configPath, 'plugins: []\nscenarios:\n  include:\n  - "mk/scenarios/**/*.yml"\n')
    await expect(
      replayMain({ kind: 'scenario', args: ['unknown-id'], configPath, cwd: workDir }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', message: expect.stringContaining('unknown scenario') })
  })
})
