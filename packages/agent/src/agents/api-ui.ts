/**
 * api-ui-agent（spec §3.4/§3.5 + plan §44.4）—— plan 全量渲染缺失字段为任务；
 * apply 逐 task 组 prompt 调 provider.edit。
 * 无状态（PLN-1）：R6/R7 的尝试状态机与批次切片在 runtime。
 * E4：PROVIDER_UNAVAILABLE 上抛（进程级）；其余 provider 失败 → task failed（E5/E6）。
 */
import { KernelError } from '@nx-mk/kernel'
import {
  defineCoverageAgent,
  type AgentApplyResult,
  type AgentContext,
  type AgentPlan,
  type AgentTask,
  type CoverageAgentPlugin,
  type TaskApplyResult,
} from '../types.js'

// plan：report.missingRequiredFields 全量渲染（endpointId 缺省 → null）
export async function planTasks(ctx: AgentContext): Promise<AgentPlan> {
  return {
    tasks: ctx.report.missingRequiredFields.map((f) => ({
      type: 'render-field' as const,
      fieldId: f.fieldId,
      fieldPath: f.fieldPath,
      endpointId: f.endpointId ?? null,
      reason: `missing required field (state=${f.state}, policyStatus=${f.policyStatus})`,
    })),
  }
}

// prompt 组装（spec §3.5）：§44.4 硬约束 + 字段上下文 + manifestSummary + policySummary + 输出格式指令
// v1 质量杠杆（4.5 备忘）：policySummary 进入 prompt —— 具体枚举 ignored 字段路径（原 v0 只给泛化规则）
export function buildPrompt(task: AgentTask, ctx: AgentContext): string {
  const endpoint = task.endpointId ?? 'unknown endpoint'
  return [
    'You are improving API/UI coverage of a frontend project.',
    `Task: make the API field "${task.fieldPath}" (endpoint: ${endpoint}) visibly rendered in the UI, so the coverage analyzer can observe real evidence.`,
    '',
    'Hard constraints:',
    '- Never render fields that the policy marks as ignored.',
    '- Never dump a response object with JSON.stringify as a substitute for real UI rendering.',
    '- Never add console.log probes for fields or coverage.',
    `- Add data-mk-field="${task.fieldId}" to the element(s) that render the field, so evidence collection can observe it.`,
    '',
    ctx.manifestSummary,
    '',
    ctx.policySummary,
    '',
    'Output exactly one fenced ```diff code block containing a unified diff (git format). No explanations outside the block.',
  ].join('\n')
}

export async function applyTasks(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult> {
  const results: TaskApplyResult[] = []
  for (const task of plan.tasks) {
    try {
      const out = await ctx.ai.edit({
        instructions: buildPrompt(task, ctx),
        context: {
          fieldId: task.fieldId,
          fieldPath: task.fieldPath,
          endpointId: task.endpointId ?? 'unknown',
          reason: task.reason,
        },
      })
      results.push({ task, status: 'diff-produced', diffText: out.diffText })
    } catch (err) {
      if (err instanceof KernelError && err.code === 'PROVIDER_UNAVAILABLE') throw err // E4 进程级
      results.push({ task, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { results }
}

export function createApiUiAgent(): CoverageAgentPlugin {
  return defineCoverageAgent({
    name: 'api-ui-agent',
    version: '0.1.0',
    capabilities: ['plan', 'apply'],
    plan: planTasks,
    apply: applyTasks,
  })
}
