/**
 * runtime 全链单测（spec §5 runtime 集成行）：scripted provider + 真 api-ui-agent +
 * scripted review-agent；真实 sqlite（临时目录共享库）+ 真实落盘。
 * 断言面：LoopSummary 计数 / patches 布局 / runs+agent_iterations 行（R3/R4/R6/R7）。
 */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { openCoverageDb } from '@nx-mk/coverage'
import { runAgentLoop } from '../runtime.js'
import { createApiUiAgent } from '../agents/api-ui.js'
import type { AgentProvider, AgentTask, AgentVerifyResult, CoverageAgentPlugin, CoverageReport } from '../types.js'

export function makeReport(missing: number, ignoredIds: string[] = []): CoverageReport {
  return {
    runId: 'run_base',
    metrics: {
      requiredCoverage: 0.4, effectiveCoverage: 0.4, rawBackendFieldCoverage: 0.4,
      endpointsTotal: 1, endpointsCalled: 1, fieldsTotal: missing, fieldsReturned: missing,
      requiredFields: missing, missingRequiredFields: missing,
      ignoredReturnedFields: ignoredIds.length, suspiciousFields: 0,
    },
    missingRequiredFields: Array.from({ length: missing }, (_, i) => ({
      fieldId: `field_${i}`, fieldPath: `data.f${i}`, endpointId: 'getUsers',
      state: 'missing' as const, policyStatus: 'required' as const,
    })),
    weakEvidenceFields: [],
    ignoredReturnedFields: ignoredIds.map((id) => ({ fieldId: id, fieldPath: id, state: 'ignored' as const, policyStatus: 'ignored' as const })),
    suspiciousCoverage: [],
    endpoints: [{ endpointId: 'getUsers', method: 'GET', path: '/users', called: true, fieldsTotal: missing, fieldsCovered: 0 }],
    requests: [],
  }
}

export const OK_PROVIDER: AgentProvider = { name: 'fake', edit: async () => ({ diffText: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b' }) }

// 可编程 verdict 的 review-agent 替身：按 fieldId 前缀决定 pass/reject
export function scriptedReview(rule: (task: AgentTask) => 'pass' | 'reject'): CoverageAgentPlugin {
  return {
    name: 'scripted-review', version: '0.0.1', capabilities: ['verify'],
    plan: async () => ({ tasks: [] }),
    apply: async () => ({ results: [] }),
    verify: async (_ctx, result): Promise<AgentVerifyResult> => {
      const r = result.results[0]
      const verdict = r && rule(r.task) === 'reject' ? 'reject' : 'pass'
      return { verdict, checks: [{ name: 'scripted', outcome: verdict === 'pass' ? 'pass' : 'reject' }] }
    },
  }
}

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'nx-mk-runtime-'))
}

async function readIterations(root: string, agentRunId: string) {
  const db = openCoverageDb(join(root, '.nx-mk', 'coverage.db'))
  const rows = db.prepare('SELECT * FROM agent_iterations WHERE run_id = ? ORDER BY id').all(agentRunId) as Record<string, unknown>[]
  const runs = db.prepare('SELECT * FROM runs WHERE id = ?').all(agentRunId) as Record<string, unknown>[]
  db.close()
  return { rows, runs }
}

describe('runAgentLoop — progression to backlog-empty (R6/R7)', () => {
  it('batches 6 fields 2-per-iteration, all produced, then stops', async () => {
    const root = makeProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(6), config: { loop: { maxTasksPerIteration: 2, maxIterations: 5 } } },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
    )
    expect(summary.stoppedBy).toBe('backlog-empty')
    expect(summary.iterations).toBe(3)
    expect(summary.produced).toBe(6)
    expect(summary.rejected).toBe(0)
    expect(summary.givenUp).toBe(0)
    expect(summary.patchDir).toBe(`.nx-mk/patches/${summary.agentRunId}`)
    // patches 布局：3 轮 × 2 个，全部在终稿目录
    const patchDir = join(root, '.nx-mk', 'patches', summary.agentRunId)
    expect(readdirSync(patchDir).filter((f) => f.endsWith('.patch'))).toHaveLength(6)
    // R4：空 run 目录（dashboard 目录扫描可见）+ runs 行 status='agent-loop' → 'completed'
    expect(existsSync(join(root, '.nx-mk', 'runs', summary.agentRunId))).toBe(true)
    const { rows, runs } = await readIterations(root, summary.agentRunId)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('completed')
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.status === 'produced')).toBe(true)
    // R3：before_coverage=0.4、after_coverage=NULL
    expect(rows[0]?.before_coverage).toBeCloseTo(0.4)
    expect(rows.every((r) => r.after_coverage === null)).toBe(true)
    expect(rows[0]?.diff_path).toContain('.nx-mk/patches/')
  })
})

describe('runAgentLoop — retry machine (R6, PLN-5)', () => {
  it('a permanently-rejected field: first attempt rejected, retry given-up, patch archived', async () => {
    const root = makeProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(1), config: {} },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'reject') },
    )
    expect(summary.stoppedBy).toBe('no-improvement') // stopIfNoImprovementRounds=2 默认
    expect(summary.rejected).toBe(1)
    expect(summary.givenUp).toBe(1)
    expect(summary.iterations).toBe(2)
    // reject 留档：终稿目录无 patch，rejected/ 有
    const patchDir = join(root, '.nx-mk', 'patches', summary.agentRunId)
    expect(readdirSync(patchDir).filter((f) => f.endsWith('.patch'))).toHaveLength(0)
    expect(readdirSync(join(patchDir, 'rejected'))).toHaveLength(2)
    const { rows } = await readIterations(root, summary.agentRunId)
    expect(rows.map((r) => r.status)).toEqual(['rejected', 'given-up'])
  })

  it('a produced field is never retried; other fields still progress', async () => {
    const root = makeProject()
    // field_0 恒 reject；其余 pass
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(3), config: { loop: { maxTasksPerIteration: 2, maxIterations: 5 } } },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview((t) => (t.fieldId === 'field_0' ? 'reject' : 'pass')) },
    )
    expect(summary.produced).toBe(2)
    expect(summary.givenUp).toBe(1)
    expect(summary.stoppedBy).toBe('backlog-empty')
    const { rows } = await readIterations(root, summary.agentRunId)
    // field_0 恰好两行（rejected + given-up），其余各一行 produced
    // （runtime 把 fieldId 写进 summary 列前缀，可按字段归因）
    expect(rows.filter((r) => String(r.summary).startsWith('field_0'))).toHaveLength(2)
    expect(rows.filter((r) => r.status === 'produced')).toHaveLength(2)
    expect(rows).toHaveLength(4)
  })
})
