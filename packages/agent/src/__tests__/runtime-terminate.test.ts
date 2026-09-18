/**
 * 终止判定单测（spec §3.2 步 6 / §38）：max-iterations / no-improvement / E4 上抛。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { openCoverageDb } from '@nx-mk/coverage'
import { runAgentLoop } from '../runtime.js'
import { createApiUiAgent } from '../agents/api-ui.js'
import { classifyClaudeSpawnError } from '../provider/claude-code.js'
import type { AgentProvider } from '../types.js'
import { makeReport, OK_PROVIDER, scriptedReview } from './runtime-loop.test.js'

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

  it('propagates PROVIDER_UNAVAILABLE and marks the runs row failed (E4)', async () => {
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
    const runs = db.prepare('SELECT * FROM agent_iterations').all()
    db.close()
    expect(runs).toHaveLength(0) // 首个 task 尚未落库即上抛
  })
})
