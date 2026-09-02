/**
 * Goal-Oriented Multi-Turn Loop —— run 阶段的多轮目标驱动采集循环（M14）
 *
 * 核心模式：多生产者（plugins emitReport） + 协调者（kernel 计算覆盖率）
 * + 目标驱动终止（goal-met / max-turns / idle / timeout / aborted）。
 *
 * 数据流（每轮 turn）：
 *   1. emit 'turn:start { turn: N, idleTurns }'
 *   2. plugins 执行本轮工作（emitReport / emitSignal）
 *   3. computeCoverage(reports, initial) → coverage[N]
 *   4. emit 'turn:end { turn: N, coverage, progress }'
 *   5. 检查终止条件（signal > goal-met > bounds > all-failed）
 *   6. 若未终止 → yield event loop → 下一轮
 *
 * 设计依据：docx/plan/2026-08-28-goal-oriented-loop-design.md
 */
import type {
  Coverage,
  GoalConfig,
  GoalResult,
  MissingItem,
  PluginReport,
} from './types'

/**
 * 计算覆盖率：从 reports 提取已覆盖项，从 initial.missing 过滤出仍未覆盖的。
 *
 * 规则：
 * - endpoint-called 覆盖 {method, path} 完全相同的 endpoint 项
 * - route-visited 覆盖相同 route
 * - field-hit 覆盖 fieldId 相同的 field 项
 * - 其他 report 类型（no-data / analysis）不直接覆盖项，但参与调试
 *
 * @param reports - 整个运行期间累积的所有 PluginReport
 * @param initial - 初始 Coverage（含 total 与 missing）
 */
export function computeCoverage(reports: PluginReport[], initial: Coverage): Coverage {
  const covered = new Set<string>()
  for (const report of reports) {
    switch (report.kind) {
      case 'endpoint-called':
        covered.add(`endpoint:${report.method}:${report.path}`)
        break
      case 'route-visited':
        covered.add(`route:${report.route}`)
        break
      case 'field-hit':
        covered.add(`field:${report.fieldId}`)
        break
      case 'no-data':
      case 'analysis':
        // 不直接覆盖项
        break
      default:
        // exhaustiveness check
        throw new Error(`Unhandled report: ${JSON.stringify(report)}`)
    }
  }

  const missing: MissingItem[] = initial.missing.filter((item) => {
    const key =
      item.kind === 'endpoint'
        ? `endpoint:${item.method}:${item.path}`
        : item.kind === 'route'
          ? `route:${item.route}`
          : item.kind === 'field'
            ? `field:${item.fieldId}`
            : `schema:${item.path}`
    return !covered.has(key)
  })

  return {
    total: initial.total,
    covered: initial.total - missing.length,
    ratio: initial.total === 0 ? 1 : (initial.total - missing.length) / initial.total,
    missing,
  }
}

/**
 * Goal Loop 终止决策（按优先级，资源保护优先）：
 *
 *   1. signal.aborted       → 'aborted'
 *   2. ratio >= targetRatio  → 'goal-met'
 *   3. turn > maxTurns       → 'max-turns'
 *   4. idleTurns >= limit    → 'idle'
 *   5. now - start >= timeout → 'timeout'
 *   6. allActiveFailed       → 'all-failed'
 */
function checkTermination(args: {
  signal: AbortSignal
  coverage: Coverage
  goal: GoalConfig
  turn: number
  idleTurns: number
  startedAt: number
  allActiveFailed: boolean
}): { kind: 'met' | 'unmet' | 'aborted' | 'continue'; reason?: GoalResult['terminatedBy'] } {
  if (args.signal.aborted) return { kind: 'aborted', reason: 'aborted' }
  if (args.coverage.ratio >= args.goal.targetRatio) {
    return { kind: 'met', reason: 'goal-met' }
  }
  if (args.turn >= args.goal.maxTurns) {
    return { kind: 'unmet', reason: 'max-turns' }
  }
  if (args.idleTurns >= args.goal.idleTurnsLimit) {
    return { kind: 'unmet', reason: 'idle' }
  }
  if (Date.now() - args.startedAt >= args.goal.absoluteTimeoutMs) {
    return { kind: 'unmet', reason: 'timeout' }
  }
  if (args.allActiveFailed) {
    return { kind: 'unmet', reason: 'all-failed' }
  }
  return { kind: 'continue' }
}

/**
 * Goal Loop 终止事件 payload 构造
 */
function buildResult(
  kind: 'met' | 'unmet' | 'aborted',
  terminatedBy: GoalResult['terminatedBy'],
  coverage: Coverage,
  turn: number,
  reports: PluginReport[],
  durationMs: number,
): GoalResult {
  return {
    kind,
    coverage,
    turns: turn,
    durationMs,
    reports,
    terminatedBy,
  }
}

/**
 * runGoalLoop —— 多轮采集 + 目标驱动终止
 *
 * 注意：此函数刻意保持简化（vs dsh ReactLoopAgent 的 500 行）：
 *   - 不引入 Inbox 抽象（plugins 直接调 emitReport）
 *   - 单层 turn 循环，无 step 内层
 *   - 不做 turn boundary 信号（plugin 通过 emitReport 决定何时声明 done）
 *   - 不持久化 session log（复用 events.jsonl）
 *
 * @param opts.plugins   - 参与本轮采集的插件列表
 * @param opts.goal      - 终止配置
 * @param opts.initialCoverage - 初始 Coverage（含 total + missing）
 * @param opts.ctx       - 共享 PluginContext（含 events emit API）
 * @param opts.signal    - AbortSignal（外部取消）
 */
export async function runGoalLoop(opts: {
  plugins: import('./plugin').Plugin[]
  goal: GoalConfig
  initialCoverage: Coverage
  ctx: import('./plugin').PluginContext
  signal: AbortSignal
}): Promise<GoalResult> {
  const startTime = Date.now()
  const reports: PluginReport[] = []
  let coverage = opts.initialCoverage
  let turn = 0
  let idleTurns = 0
  const allActiveFailed = false

  // 边界：初始已达成
  if (coverage.ratio >= opts.goal.targetRatio) {
    return buildResult('met', 'goal-met', coverage, 0, reports, Date.now() - startTime)
  }

  while (true) {
    turn++

    // 1. 边界检查
    const decision = checkTermination({
      signal: opts.signal,
      coverage,
      goal: opts.goal,
      turn,
      idleTurns,
      startedAt: startTime,
      allActiveFailed,
    })

    if (decision.kind !== 'continue' && decision.reason) {
      return buildResult(decision.kind, decision.reason, coverage, turn, reports, Date.now() - startTime)
    }

    // 2. turn 起点
    opts.ctx.events.emit({
      type: 'turn:start',
      turn,
      timestamp: new Date().toISOString(),
      idleTurns,
    })

    // 3. drain microtask 让插件报告有机会注入
    await Promise.resolve()

    // 4. turn 终点 + 计算新覆盖率
    const previousRatio = coverage.ratio
    coverage = computeCoverage(reports, opts.initialCoverage)
    const progress: 'improved' | 'stagnant' | 'regressed' =
      coverage.ratio > previousRatio
        ? 'improved'
        : coverage.ratio < previousRatio
          ? 'regressed'
          : 'stagnant'

    if (progress === 'stagnant') idleTurns++
    else idleTurns = 0

    opts.ctx.events.emit({
      type: 'turn:end',
      turn,
      timestamp: new Date().toISOString(),
      coverage,
      progress,
    })

    // 5. 目标检查（在 turn:end 后立即判定，避免多余一轮）
    if (coverage.ratio >= opts.goal.targetRatio) {
      return buildResult('met', 'goal-met', coverage, turn, reports, Date.now() - startTime)
    }
  }
}