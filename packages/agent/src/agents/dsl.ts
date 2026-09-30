/**
 * dsl-agent（C7 / plan §35.3）—— 根据 Request Trace 自动生成或补充 Request DSL。
 *
 * C9 解锁（§26.2）：Request DSL schema/generate 已落（@nx-mk/scenario/request-dsl），
 * 从 CoverageReport.requests（drained traces 投影）可**确定性**生成 YAML——无需 AI。
 * v0 设计：plan 产出 `add-request-dsl` 任务（每条候选 trace 一个）；apply **不调 provider**，
 * 直接渲染 DSL YAML 为「diff 形状」文本（全部新增行的 unified diff 头 + + 行），
 * 交由既有 review guard / runtime 落盘通道一致处理（零工作区写入铁律不破）。
 *
 * 这使 dsl-agent 成为第一个确定性 agent：无 provider 依赖、可离线 dry-run。
 */
import {
  defineCoverageAgent,
  type AgentApplyResult,
  type AgentContext,
  type AgentPlan,
  type AgentTask,
  type CoverageAgentPlugin,
  type TaskApplyResult,
} from '../types.js'
import {
  generateRequestDslFromTraces,
  renderRequestDslYaml,
  type GeneratedRequest,
} from '@nx-mk/scenario/request-dsl'

// plan：已捕获 trace 全量渲染（去重/失败剔除由 generate 内部裁定）→ 提示补 DSL 断言。
// 与生成器共享一次计算太早（apply 才真正渲染）；plan 只枚举候选，apply 现算。
export function planDslTasks(ctx: AgentContext): AgentPlan {
  return {
    tasks: ctx.report.requests.map((r) => ({
      type: 'add-request-dsl' as const,
      requestId: r.requestId ?? 'unknown',
      endpointId: r.endpointId ?? null,
      method: r.method ?? 'GET',
      path: r.path ?? r.url ?? 'unknown',
      status: r.status ?? null,
      reason:
        r.status !== undefined && r.status >= 400
          ? `trace status=${r.status} (excluded from generated DSL by design)`
          : 'captured request without a reusable Request DSL statement (§26.2)',
    })),
  }
}

// apply：确定性生成（不再调用 provider）—— 每任务渲染该请求的单条 DSL 语句。
// 产出形态为对假想 dsl.generated.yml 的统一 diff（review guard 的 addedLines 可直检：
// 无 data-mk-field/console.log/JSON.stringify —— 静态 G2/G3/G4 天然通过）。
export async function applyDslTasks(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult> {
  // 用 report.requests 现算全集（R8：不回读 run 产物），按任务 requestId 过滤对应条目
  const traces = ctx.report.requests.map((r) => ({
    requestId: r.requestId, method: r.method ?? 'GET', url: r.url ?? r.path ?? 'unknown',
    status: r.status, responsePreview: undefined,
  }))
  const generated: GeneratedRequest[] = generateRequestDslFromTraces(traces)
  const byKey = new Map(generated.map((g) => [`${g.request.method} ${new URL(g.request.url, 'http://x').pathname}`, g.request]))

  const results: TaskApplyResult[] = []
  const seen = new Set<string>() // 同一 apply 批次内跨任务去重（同 trace 第二条任务 → duplicate）
  for (const task of plan.tasks) {
    if (task.type !== 'add-request-dsl') continue
    try {
      const key = `${task.method} ${new URL(task.path, 'http://x').pathname}`
      const decl = byKey.get(key)
      if (!decl || seen.has(key)) {
        results.push({
          task,
          status: 'failed',
          error: seen.has(key) ? 'duplicate trace (deduped by method+pathname within this batch)' : 'not eligible for DSL generation (deduped, excluded by status>=400, or unparseable url)',
        })
        continue
      }
      seen.add(key)
      const yaml = renderRequestDslYaml([decl])
      const diffText = [
        '--- a/.nx-mk/runs/current/dsl.generated.yml',
        '+++ b/.nx-mk/runs/current/dsl.generated.yml',
        '@@ -0,0 +1 @@',
        ...yaml.trimEnd().split('\n').map((l) => `+${l}`),
      ].join('\n')
      results.push({ task, status: 'diff-produced', diffText })
    } catch (err) {
      results.push({ task, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { results }
}

export function createDslAgent(): CoverageAgentPlugin {
  return defineCoverageAgent({
    name: 'dsl-agent',
    version: '0.1.0',
    capabilities: ['plan', 'apply'],
    plan: async (ctx) => planDslTasks(ctx),
    apply: applyDslTasks,
  })
}
