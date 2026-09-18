/**
 * Agent Runtime（spec §3.2/§3.4）—— runAgentLoop 编排：
 * 批次（R7）→ provider 产 diff → 落盘终稿（PLN-2）→ review guard →
 * reject 留档 rename → agent_iterations 落库（R3/R4/PLN-5）→ 终止判定（R6/§38）。
 * provider/agent 均由 LoopDeps 注入（Phase 4 StartDeps 同风格），runtime 不感知 spawn。
 */
import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { KernelError } from '@nx-mk/kernel'
import { openCoverageDb, type CoverageDb, type CoverageReport } from '@nx-mk/coverage'
import { sanitizeFieldSlug, toPosixRel, writePatchFile } from './patches.js'
import type {
  AgentConfig, AgentContext, AgentTask, CoverageAgentPlugin,
  LoopDeps, LoopOptions, LoopSummary, TaskApplyResult,
} from './types.js'

// 默认值（spec §3.8：§38 逐字 + provider 默认；CLI 装配层也复用 provider 项）
export const AGENT_DEFAULTS = {
  provider: { timeoutMs: 300_000, maxTurns: 8 },
  loop: { maxIterations: 5, stopIfNoImprovementRounds: 2, maxTasksPerIteration: 5 },
} as const

export interface ResolvedAgentConfig {
  maxIterations: number
  stopIfNoImprovementRounds: number
  maxTasksPerIteration: number
}

// config.agent 原始可选段 → 补全默认值
export function resolveAgentConfig(config: AgentConfig | undefined): ResolvedAgentConfig {
  return {
    maxIterations: config?.loop?.maxIterations ?? AGENT_DEFAULTS.loop.maxIterations,
    stopIfNoImprovementRounds: config?.loop?.stopIfNoImprovementRounds ?? AGENT_DEFAULTS.loop.stopIfNoImprovementRounds,
    maxTasksPerIteration: config?.loop?.maxTasksPerIteration ?? AGENT_DEFAULTS.loop.maxTasksPerIteration,
  }
}

// agentRunId：agent_YYYYMMDD_HHMMSS_<4位随机>（同秒多次执行不撞目录；目录名安全）
export function makeAgentRunId(now = new Date()): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const HH = String(now.getHours()).padStart(2, '0')
  const MM = String(now.getMinutes()).padStart(2, '0')
  const SS = String(now.getSeconds()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 6)
  return `agent_${yyyy}${mm}${dd}_${HH}${MM}${SS}_${rand}`
}

// R8：manifestSummary / policySummary 由 CoverageReport 派生（不读 manifest.json）
export function renderManifestSummary(report: CoverageReport): string {
  const lines = report.endpoints.map(
    (e) => `- ${e.method} ${e.path} (called=${e.called}, fields ${e.fieldsCovered}/${e.fieldsTotal})`,
  )
  return ['Manifest endpoints:', ...(lines.length > 0 ? lines : ['- (no endpoints)'])].join('\n')
}

export function renderPolicySummary(report: CoverageReport): string {
  return [
    `Policy summary: requiredCoverage=${report.metrics.requiredCoverage}, missingRequired=${report.metrics.missingRequiredFields}, ignoredReturned=${report.metrics.ignoredReturnedFields}.`,
    'Never render fields from the ignored set.',
  ].join('\n')
}

// 跨轮尝试状态（R6）：一个 fieldId 至多两次尝试；produced / 二次失败即 done
interface AttemptState { tries: number; done: 'produced' | 'given-up' | null }

// agent_iterations 逐 task 一行（spec §3.7；status 枚举 PLN-5）
interface IterationRow {
  id: string
  runId: string
  iteration: number
  status: 'produced' | 'rejected' | 'failed' | 'given-up'
  summary: string
  beforeCoverage: number
  diffPath: string | null
}

// INSERT 列名以 packages/coverage/src/db/schema.ts 的 agent_iterations DDL 为准（实现前核对）
function persistIteration(db: CoverageDb, row: IterationRow): void {
  db.prepare(
    `INSERT INTO agent_iterations (id, run_id, iteration, status, summary, before_coverage, after_coverage, diff_path, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    row.id, row.runId, row.iteration, row.status, row.summary,
    row.beforeCoverage, row.diffPath,
    new Date().toISOString(), new Date().toISOString(),
  )
}

export async function runAgentLoop(opts: LoopOptions, deps: LoopDeps): Promise<LoopSummary> {
  const log = opts.log ?? (() => {})
  const cfg = resolveAgentConfig(opts.config)
  const agentRunId = makeAgentRunId()
  const nxMkDir = join(opts.projectRoot, '.nx-mk')

  // E9（PLN-9）：产物目录 / 共享库准备失败 → KERNEL_INTERNAL（退出码 5）
  const failInternal = (scope: string, err: unknown): KernelError =>
    err instanceof KernelError ? err : new KernelError('KERNEL_INTERNAL', `failed to prepare ${scope} under ${nxMkDir}`, err)

  let patchDir: string
  let rejectedDir: string
  let db: CoverageDb
  let beforeCoverage: number
  try {
    // R4：共享库 + 空运行目录（dashboard 目录扫描可见）
    mkdirSync(join(nxMkDir, 'runs', agentRunId), { recursive: true })
    patchDir = join(nxMkDir, 'patches', agentRunId)
    rejectedDir = join(patchDir, 'rejected')
    mkdirSync(rejectedDir, { recursive: true })
    db = openCoverageDb(join(nxMkDir, 'coverage.db'))
    // E10：共享库并发写保护；超时仍败才抛
    db.pragma('busy_timeout = 2000')
    beforeCoverage = opts.report.metrics.requiredCoverage
    db.insertRun(agentRunId, new Date().toISOString(), 'agent-loop')
  } catch (err) {
    throw failInternal('.nx-mk artifacts', err)
  }

  const ctx: AgentContext = {
    report: opts.report,
    manifestSummary: renderManifestSummary(opts.report),
    policySummary: renderPolicySummary(opts.report),
    projectRoot: opts.projectRoot,
    ai: deps.provider,
    log,
  }

  const attempts = new Map<string, AttemptState>()
  let produced = 0
  let rejected = 0
  let failed = 0
  let givenUp = 0
  let iterations = 0
  let noImprovementRounds = 0
  let stoppedBy: LoopSummary['stoppedBy'] = 'max-iterations'

  try {
    // PLN-1：plan 渲染全量待办；切片与重试判定在 runtime
    const backlog: AgentTask[] = (await deps.apiUiAgent.plan(ctx)).tasks

    while (true) {
      // R7：每轮取待办切片（R6：produced / given-up 除外；重试至多一次）
      const batch: AgentTask[] = []
      for (const t of backlog) {
        if (batch.length >= cfg.maxTasksPerIteration) break
        const st = attempts.get(t.fieldId)
        if (st && (st.done !== null || st.tries >= 2)) continue
        batch.push(t)
      }
      if (batch.length === 0) { stoppedBy = 'backlog-empty'; break }
      if (iterations >= cfg.maxIterations) { stoppedBy = 'max-iterations'; break }
      iterations += 1

      const applied = await deps.apiUiAgent.apply(ctx, { tasks: batch })
      let iterProduced = 0

      for (let i = 0; i < applied.results.length; i++) {
        const r: TaskApplyResult = applied.results[i]!
        const st: AttemptState = attempts.get(r.task.fieldId) ?? { tries: 0, done: null }
        st.tries += 1
        attempts.set(r.task.fieldId, st)

        let status: IterationRow['status']
        let summary: string
        let diffPath: string | null = null

        if (r.status === 'failed') {
          // E5/E6：task 级失败，继续其余 task（PLN-5：二次失败即 given-up）
          if (st.tries >= 2) { status = 'given-up'; givenUp += 1 } else { status = 'failed'; failed += 1 }
          summary = `${r.task.fieldId}: ${r.error ?? 'provider failed'}`
        } else {
          // PLN-2：先写终稿路径（G1 需要落盘文件），reject 再 rename 留档
          const slug = sanitizeFieldSlug(r.task.fieldId)
          let abs: string
          try {
            abs = writePatchFile(patchDir, `iter-${iterations}-${slug}.patch`, r.diffText ?? '')
          } catch (err) {
            throw failInternal('patch file', err) // E9
          }
          r.patchRelPath = toPosixRel(abs, opts.projectRoot)
          // PLN-4：逐 task 单结果包装；PLN-6：无 verify 视为 pass
          const vr = (await deps.reviewAgent.verify?.(ctx, { results: [r] })) ?? { verdict: 'pass' as const, checks: [] }
          if (vr.verdict === 'pass') {
            status = 'produced'
            produced += 1
            iterProduced += 1
            st.done = 'produced'
            diffPath = r.patchRelPath
            summary = `${r.task.fieldId}: accepted`
          } else {
            try {
              renameSync(abs, join(rejectedDir, `iter-${iterations}-${slug}.patch`))
            } catch (err) {
              throw failInternal('rejected archive', err) // E9
            }
            if (st.tries >= 2) { status = 'given-up'; givenUp += 1 } else { status = 'rejected'; rejected += 1 }
            const why = vr.checks.filter((c) => c.outcome === 'reject').map((c) => `${c.name}: ${c.detail ?? 'rejected'}`).join('; ')
            summary = `${r.task.fieldId}: ${why}`
          }
        }
        persistIteration(db, {
          id: `ai_${agentRunId}_${iterations}_${i}`, runId: agentRunId, iteration: iterations,
          status, summary, beforeCoverage, diffPath,
        })
        log(`  iter ${iterations} [${i + 1}/${applied.results.length}] ${r.task.fieldId} → ${status}`)
      }

      // §38：连续 stopIfNoImprovementRounds 轮零 produced → 提前终止
      if (iterProduced === 0) {
        noImprovementRounds += 1
        if (noImprovementRounds >= cfg.stopIfNoImprovementRounds) { stoppedBy = 'no-improvement'; break }
      } else {
        noImprovementRounds = 0
      }
    }

    db.endRun(agentRunId, new Date().toISOString(), 'completed')
  } catch (err) {
    db.endRun(agentRunId, new Date().toISOString(), 'failed')
    throw err
  } finally {
    db.close()
  }

  return {
    agentRunId,
    iterations,
    produced,
    rejected,
    failed,
    givenUp,
    patchDir: toPosixRel(patchDir, opts.projectRoot),
    stoppedBy,
  }
}
