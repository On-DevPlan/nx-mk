/**
 * run 命令 collect 装配单测（spec §3.6）：临时 fixture 项目（hermetic，不真跑 vite/browser）。
 * - collect 无配置 → 不建 coverage.db
 * - collect 配置 → run 结束后 coverage.db 存在（db path 指 tmp：经 cwd 注入）
 * - runs 表登记本次 run（insertRun → endRun completed）
 * - 注入的共享 collector 在 run 结束 flushDrained 落三表
 * - collect.url 非 http(s) → CONFIG_INVALID fail-fast（spec §4）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMain } from '../commands/run'
import { openCoverageDb } from '@nx-mk/coverage'
import { createCollector } from '@nx-mk/client/collector'

let workDir: string
let configPath: string
let dbPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-run-collect-'))
  configPath = join(workDir, 'nx-mk.config.yml')
  dbPath = join(workDir, '.nx-mk', 'coverage.db')
  writeFileSync(configPath, 'plugins: []\nlogLevel: info\n')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

// 收敛 console.log 静音（runMain 成功路径会打印运行摘要）
function silenceConsole(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'log').mockImplementation(() => {})
}

describe('runMain collect 装配（spec §3.6）', () => {
  it('collect 缺失 → 不建 coverage.db', async () => {
    const log = silenceConsole()
    try {
      await runMain({ configPath, runId: 'run_nodb', cwd: workDir })
    } finally {
      log.mockRestore()
    }
    expect(existsSync(dbPath)).toBe(false)
  })

  it('collect 配置 → runs 表登记本次 run（insertRun → endRun completed）', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    const log = silenceConsole()
    try {
      await runMain({ configPath, runId: 'run_db', cwd: workDir })
    } finally {
      log.mockRestore()
    }
    expect(existsSync(dbPath)).toBe(true)
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT id, status, ended_at FROM runs').all()).toEqual([
        { id: 'run_db', status: 'completed', ended_at: expect.any(String) },
      ])
    } finally {
      db.close()
    }
  })

  it('run 结束后 coverage.db 文件存在于注入的 cwd（tmp）', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
    const log = silenceConsole()
    try {
      await runMain({ configPath, runId: 'run_file', cwd: workDir })
    } finally {
      log.mockRestore()
    }
    // db path 指 tmp：不存在于仓库 cwd，只存在于注入的 workDir
    expect(existsSync(dbPath)).toBe(true)
  })

  it('注入共享 collector → run 结束 flushDrained 落 field_hits/request_traces/ui_evidence', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'http://localhost:5173'\n")
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
    try {
      await runMain({ configPath, runId: 'run_flush', cwd: workDir, collector })
    } finally {
      log.mockRestore()
    }
    const db = openCoverageDb(dbPath)
    try {
      expect(db.prepare('SELECT count(*) AS n FROM field_hits').get()).toEqual({ n: 1 })
      expect(db.prepare('SELECT count(*) AS n FROM request_traces').get()).toEqual({ n: 1 })
      expect(db.prepare('SELECT count(*) AS n FROM ui_evidence').get()).toEqual({ n: 1 })
    } finally {
      db.close()
    }
  })

  it('collect.url 非 http(s) → CONFIG_INVALID 且不建 db', async () => {
    writeFileSync(configPath, "plugins: []\ncollect:\n  url: 'ftp://example.com'\n")
    await expect(
      runMain({ configPath, runId: 'run_badurl', cwd: workDir }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    expect(existsSync(dbPath)).toBe(false)
  })
})
