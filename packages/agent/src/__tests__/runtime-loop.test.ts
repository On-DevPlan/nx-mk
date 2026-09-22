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
import { runAgentLoop, renderPolicySummary } from '../runtime.js'
import { createApiUiAgent } from '../agents/api-ui.js'
import { makeReport, OK_PROVIDER, scriptedReview } from './fixtures.js'

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

describe('renderPolicySummary — ignored ids 枚举（4.5 备忘 v1 杠杆）', () => {
  it('enumerates deduped ignored field paths from the report (R8: report-derived only)', () => {
    const s = renderPolicySummary(makeReport(2, ['data.a.b', 'data.a.b', 'data.x']))
    expect(s).toContain('Ignored field paths observed this run (never render any of them): data.a.b, data.x.')
  })

  it('falls back to (none) when no ignored fields were observed', () => {
    const s = renderPolicySummary(makeReport(1))
    expect(s).toContain('Ignored field paths observed this run (never render any of them): (none).')
  })
})
