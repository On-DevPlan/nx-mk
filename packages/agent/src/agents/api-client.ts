/**
 * api-client-agent（C7 / plan §35.2）—— 根据 CoverageReport 生成或修复 API client 调用。
 *
 * 职责收口（v0）：plan 产出 `add-api-call` 任务 —— 针对本 run **从未被调用**的 endpoint
 * （endpoints[].called=false），提示 agent 在前端补上真实调用（而非伪造请求）。
 * apply 走 provider.edit 产 suggest-diff（同 api-ui-agent 铁律：零工作区写入，diff 文本落盘
 * .nx-mk/patches/ 由 runtime 负责，本 agent 只产 diff）。
 *
 * 有状态约定：依赖 CoverageReport（R8 只读输入），无自身状态（PLN-1 同款）。
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

// plan：未调用 endpoint 全量渲染为 add-api-call 任务（每 endpoint 一个调用点任务；
// v0 不做 endpoint 内字段级拆分 —— 调用即触发字段采集，字段覆盖由后续轮次评估）
export function planApiCallTasks(ctx: AgentContext): AgentPlan {
  return {
    tasks: ctx.report.endpoints
      .filter((e) => !e.called)
      .map((e) => ({
        type: 'add-api-call' as const,
        endpointId: e.endpointId,
        method: e.method,
        path: e.path,
        reason: `endpoint never called this run (fields 0/${e.fieldsTotal} observable until called)`,
      })),
  }
}

export function buildApiCallPrompt(task: AgentTask & { type: 'add-api-call' }, ctx: AgentContext): string {
  return [
    'You are improving API coverage of a frontend project.',
    `Task: add a real call to the API endpoint ${task.method} ${task.path} (endpointId: ${task.endpointId}) from the frontend, where it makes product sense.`,
    '',
    'Hard constraints:',
    '- Never fake a request: the call must render or otherwise consume real response data in the UI (e.g., a list view, a detail panel) so the coverage analyzer can observe field hits.',
    '- Never render fields that the policy marks as ignored.',
    '- Never dump a response object with JSON.stringify as a substitute for real UI rendering.',
    '- Never add console.log probes for fields or coverage.',
    '- Do not invent fields the manifest does not declare.',
    '',
    ctx.manifestSummary,
    '',
    ctx.policySummary,
    '',
    'Output exactly one fenced ```diff code block containing a unified diff (git format). No explanations outside the block.',
  ].join('\n')
}

export async function applyApiCallTasks(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult> {
  const results: TaskApplyResult[] = []
  for (const task of plan.tasks) {
    if (task.type !== 'add-api-call') continue // 非本 agent 任务类型跳过（协议宽容，不抛）
    try {
      const out = await ctx.ai.edit({
        instructions: buildApiCallPrompt(task, ctx),
        context: {
          endpointId: task.endpointId,
          method: task.method,
          path: task.path,
          reason: task.reason,
        },
      })
      results.push({ task, status: 'diff-produced', diffText: out.diffText })
    } catch (err) {
      results.push({ task, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { results }
}

export function createApiClientAgent(): CoverageAgentPlugin {
  return defineCoverageAgent({
    name: 'api-client-agent',
    version: '0.1.0',
    capabilities: ['plan', 'apply'],
    plan: async (ctx) => planApiCallTasks(ctx),
    apply: applyApiCallTasks,
  })
}
