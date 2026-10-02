/**
 * Agent Runtime（spec §3.2/§3.4）—— runAgentLoop 编排：
 * 批次（R7）→ provider 产 diff → 落盘终稿（PLN-2）→ review guard →
 * reject 留档 rename → agent_iterations 落库（R3/R4/PLN-5）→ 终止判定（R6/§38）。
 * provider/agent 均由 LoopDeps 注入（Phase 4 StartDeps 同风格），runtime 不感知 spawn。
 */
import { mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { KernelError } from '@nx-mk/kernel'
import { openCoverageDb, type CoverageDb, type CoverageReport } from '@nx-mk/coverage'
import { sanitizeFieldSlug, toPosixRel, writePatchFile } from './patches.js'
import { loadStyleTemplate } from './style/loader.js'
import type { StyleTemplate } from './style/types.js'
import { taskIdOf, type AgentConfig, type AgentApplyResult, type AgentContext, type AgentTask, type CoverageAgentPlugin, type LoopDeps, type LoopOptions, type LoopSummary, type TaskApplyResult } from './types.js'

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
  // v1 质量杠杆（4.5 备忘）：ignored ids 进 policySummary 消费 —— 枚举本 run 观测到的
  // ignored 字段路径（R8：仍只从 CoverageReport 派生，不读 manifest.json）。
  // C2（§16 对齐）：用户配置的 reason 一并透出，agent 能看到「为什么忽略」。
  const knownIgnored = [...new Set(
    report.ignoredReturnedFields.map((f) =>
      f.matchedRule?.reason ? `${f.fieldPath} (${f.matchedRule.reason})` : f.fieldPath,
    ),
  )]
  return [
    `Policy summary: requiredCoverage=${report.metrics.requiredCoverage}, missingRequired=${report.metrics.missingRequiredFields}, ignoredReturned=${report.metrics.ignoredReturnedFields}.`,
    `Ignored field paths observed this run (never render any of them): ${knownIgnored.length > 0 ? knownIgnored.join(', ') : '(none)'}.`,
  ].join('\n')
}

// 跨轮尝试状态（R6）：一个 taskIdOf 键（render-field 即 fieldId）至多两次尝试；produced / 二次失败即 done
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
  // 风格模板启动期解析（spec 2026-10-02 §3：进程级 fail-fast —— config 错误不烧 LLM 轮次、不落任何 run 产物）。
  // DS3 关键：仅在 id 或 path **显式配置**时回填 ctx.style —— 未配置必须保持 undefined，
  // 否则 G5 会对未配置用户生效（宿主扫描可能拒绝其合法 patch），破坏现网兼容铁律。
  const style: StyleTemplate | undefined =
    opts.config.style?.id || opts.config.style?.path
      ? loadStyleTemplate(opts.config.style, { projectRoot: opts.projectRoot, log })
      : undefined
  const agentRunId = makeAgentRunId()
  const nxMkDir = join(opts.projectRoot, '.nx-mk')

  // E9/E10（PLN-9）：目录准备 / 共享库读写失败 → KERNEL_INTERNAL（退出码 5）；已是 KernelError 则原样透传
  const wrapInternal = (what: string, err: unknown): KernelError =>
    err instanceof KernelError ? err : new KernelError('KERNEL_INTERNAL', `${what} under ${nxMkDir}`, err)

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
    throw wrapInternal('failed to prepare .nx-mk artifacts', err)
  }

  const ctx: AgentContext = {
    report: opts.report,
    manifestSummary: renderManifestSummary(opts.report),
    policySummary: renderPolicySummary(opts.report),
    projectRoot: opts.projectRoot,
    ai: deps.provider,
    log,
    style, // spec 2026-10-02 §2.4/§2.5：prompt 注入 + G5 共用；undefined = 完全现网行为
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
    // C8：多 agent plan 合并 backlog（保序：agent 顺序 × 各自任务序）；
    // owner 按来源 agent 记账（apply 路由依据）。单 agent plan 失败 → 跳过该 agent（E 容错）。
    const ownerByTask = new Map<string, CoverageAgentPlugin>()
    const backlog: AgentTask[] = []
    if (deps.agents.length === 0) {
      throw new KernelError('KERNEL_INTERNAL', 'no agents configured for agent loop', null)
    }
    for (const agent of deps.agents) {
      let plan
      try {
        plan = await agent.plan(ctx)
      } catch (err) {
        log(`[agent] ${agent.name} plan failed, skipped: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      for (const t of plan.tasks) ownerByTask.set(taskIdOf(t), agent)
      backlog.push(...plan.tasks)
    }

    while (true) {
      // R7：每轮取待办切片（R6：produced / given-up 除外；重试至多一次）
      const batch: AgentTask[] = []
      for (const t of backlog) {
        if (batch.length >= cfg.maxTasksPerIteration) break
        const st = attempts.get(taskIdOf(t))
        if (st && (st.done !== null || st.tries >= 2)) continue
        batch.push(t)
      }
      if (batch.length === 0) { stoppedBy = 'backlog-empty'; break }
      if (iterations >= cfg.maxIterations) { stoppedBy = 'max-iterations'; break }
      iterations += 1

      // C8：批次 task 按来源 agent 分组路由（同批跨 agent 混合不串线）；逐 owner apply 依序合并
      const byOwner = new Map<CoverageAgentPlugin, AgentTask[]>()
      for (const t of batch) {
        const owner = ownerByTask.get(taskIdOf(t)) ?? deps.agents[0]!
        const list = byOwner.get(owner) ?? []
        list.push(t)
        byOwner.set(owner, list)
      }
      const applied: AgentApplyResult = { results: [] }
      for (const [owner, tasks] of byOwner) {
        const r = await owner.apply(ctx, { tasks })
        applied.results.push(...r.results)
      }
      let iterProduced = 0

      for (let i = 0; i < applied.results.length; i++) {
        const r: TaskApplyResult = applied.results[i]!
        const st: AttemptState = attempts.get(taskIdOf(r.task)) ?? { tries: 0, done: null }
        st.tries += 1
        attempts.set(taskIdOf(r.task), st)

        let status: IterationRow['status']
        let summary: string
        let diffPath: string | null = null

        if (r.status === 'failed') {
          // E5/E6：task 级失败，继续其余 task（PLN-5：二次失败即 given-up）
          if (st.tries >= 2) { status = 'given-up'; givenUp += 1 } else { status = 'failed'; failed += 1 }
          summary = `${taskIdOf(r.task)}: ${r.error ?? 'provider failed'}`
        } else {
          // PLN-2：先写终稿路径（G1 需要落盘文件），reject 再 rename 留档
          const slug = sanitizeFieldSlug(taskIdOf(r.task))
          let abs: string
          try {
            abs = writePatchFile(patchDir, `iter-${iterations}-${slug}.patch`, r.diffText ?? '')
          } catch (err) {
            throw wrapInternal('failed to prepare patch file', err) // E9
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
            summary = `${taskIdOf(r.task)}: accepted`
          } else {
            try {
              // EXEC-7：嵌套 slug（白名单含 '/'）在 rename 目标侧同样要建父目录 —— 与
              // writePatchFile 的 PLN-8 递归建目录对称（否则 rejected 留档 ENOENT → E9）
              const dest = join(rejectedDir, `iter-${iterations}-${slug}.patch`)
              mkdirSync(dirname(dest), { recursive: true })
              renameSync(abs, dest)
            } catch (err) {
              throw wrapInternal('failed to prepare rejected archive', err) // E9
            }
            if (st.tries >= 2) { status = 'given-up'; givenUp += 1 } else { status = 'rejected'; rejected += 1 }
            const why = vr.checks.filter((c) => c.outcome === 'reject').map((c) => `${c.name}: ${c.detail ?? 'rejected'}`).join('; ')
            summary = `${taskIdOf(r.task)}: ${why}`
          }
        }
        try {
          persistIteration(db, {
            id: `ai_${agentRunId}_${iterations}_${i}`, runId: agentRunId, iteration: iterations,
            status, summary, beforeCoverage, diffPath,
          })
        } catch (err) {
          throw wrapInternal('failed to persist agent_iterations row', err) // E10
        }
        log(`  iter ${iterations} [${i + 1}/${applied.results.length}] ${taskIdOf(r.task)} → ${status}`)
      }

      // §38：连续 stopIfNoImprovementRounds 轮零 produced → 提前终止
      if (iterProduced === 0) {
        noImprovementRounds += 1
        if (noImprovementRounds >= cfg.stopIfNoImprovementRounds) { stoppedBy = 'no-improvement'; break }
      } else {
        noImprovementRounds = 0
      }
    }

    try {
      db.endRun(agentRunId, new Date().toISOString(), 'completed')
    } catch (err) {
      throw wrapInternal('failed to end agent run', err) // E10
    }
  } catch (err) {
    // E10：标记失败的 UPDATE 自身失败（如写锁仍被占用）时吞掉并记日志，不得掩盖原始错误
    try {
      db.endRun(agentRunId, new Date().toISOString(), 'failed')
    } catch (endErr) {
      log(`[agent] failed to mark run ${agentRunId} as failed: ${endErr instanceof Error ? endErr.message : String(endErr)}`)
    }
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
