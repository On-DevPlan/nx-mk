/**
 * 终止判定单测（spec §3.2 步 6 / §38）：max-iterations / no-improvement / E4 上抛。
 */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { openCoverageDb } from '@nx-mk/coverage'
import { runAgentLoop } from '../runtime.js'
import { createApiUiAgent } from '../agents/api-ui.js'
import { classifyClaudeSpawnError } from '../provider/claude-code.js'
import type { AgentProvider } from '../types.js'
// 共享替身走 fixtures.ts（测试文件互 import 会致 vitest 重复注册用例 —— 见 fixtures.ts 头注）
import { makeReport, OK_PROVIDER, scriptedReview } from './fixtures.js'

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'nx-mk-terminate-'))
}

describe('termination', () => {
  it('stops at maxIterations when backlog remains', async () => {
    const root = makeProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(5), config: { loop: { maxIterations: 1, maxTasksPerIteration: 2 } } },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
    )
    expect(summary.stoppedBy).toBe('max-iterations')
    expect(summary.iterations).toBe(1)
    expect(summary.produced).toBe(2) // 只跑了第一批
  })

  it('stops after stopIfNoImprovementRounds consecutive zero-produced rounds', async () => {
    const root = makeProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(4), config: { loop: { maxTasksPerIteration: 2, stopIfNoImprovementRounds: 2 } } },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'reject') },
    )
    // iter1: f0,f1 rejected；iter2: f0,f1 given-up → 连续 2 轮零 produced → 提前终止（f2/f3 未触达）
    expect(summary.stoppedBy).toBe('no-improvement')
    expect(summary.iterations).toBe(2)
    expect(summary.produced).toBe(0)
    expect(summary.rejected).toBe(2)
    expect(summary.givenUp).toBe(2)
  })

  it('provider task failures also count as no-improvement rounds (E5)', async () => {
    const root = makeProject()
    const failing: AgentProvider = { name: 'fake', edit: async () => { throw new Error('claude exited with code 1') } }
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(1), config: {} },
      { provider: failing, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
    )
    expect(summary.failed).toBe(1)
    expect(summary.givenUp).toBe(1)
    expect(summary.stoppedBy).toBe('no-improvement')
  })

  it('propagates PROVIDER_UNAVAILABLE, no iteration rows, runs row marked failed (E4)', async () => {
    const root = makeProject()
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    // 修复记录（T7 deviation）：真实链路中 ENOENT→PROVIDER_UNAVAILABLE 分类发生在 provider 内部
    // （provider/claude-code.ts 的 classifyClaudeSpawnError），此处替身复用同一分类器以保真。
    const failing: AgentProvider = { name: 'fake', edit: async () => { throw classifyClaudeSpawnError(enoent) } }
    await expect(runAgentLoop(
      { projectRoot: root, report: makeReport(1), config: {} },
      { provider: failing, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
    )).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    const db = openCoverageDb(join(root, '.nx-mk', 'coverage.db'))
    const iters = db.prepare('SELECT * FROM agent_iterations').all()
    const runRows = db.prepare('SELECT * FROM runs').all() as Record<string, unknown>[]
    db.close()
    expect(iters).toHaveLength(0) // 首个 task 尚未落库即上抛
    expect(runRows).toHaveLength(1)
    expect(runRows[0]?.status).toBe('failed') // E4：runs 行标记失败
  })

  it('wraps mid-loop db write failures as KERNEL_INTERNAL (E10)', async () => {
    const root = makeProject()
    // 确定性锁占用：第二连接在 provider edit 期间 BEGIN EXCLUSIVE（WAL 下等价 IMMEDIATE，
    // 立即持有写锁），runtime 的 busy_timeout=2000 耗尽后 persistIteration 抛 SQLITE_BUSY。
    mkdirSync(join(root, '.nx-mk'), { recursive: true })
    const holder = new Database(join(root, '.nx-mk', 'coverage.db'))
    const lockHolder: AgentProvider = {
      name: 'lock-holder',
      edit: async () => {
        holder.exec('BEGIN EXCLUSIVE')
        return { diffText: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b' }
      },
    }
    try {
      await expect(runAgentLoop(
        { projectRoot: root, report: makeReport(1), config: {} },
        { provider: lockHolder, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
      )).rejects.toMatchObject({ code: 'KERNEL_INTERNAL' })
    } finally {
      holder.exec('ROLLBACK')
      holder.close()
    }
  })
})
