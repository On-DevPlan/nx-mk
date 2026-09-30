/**
 * policy-agent（C7 / plan §35.4）—— 分析 ignored / unknown 字段，建议 Coverage Policy 调整。
 *
 * §35.4 铁律：**默认只建议，不自动修改 policy**（v0 亦不实现自动写 config —— combine
 * suggest-diff 语义：产「建议 diff」文本走 provider.edit，用户自行决定是否应用）。
 * 任务类型 `suggest-policy`：针对 suspiciousCoverage 与 ignoredReturnedFields，
 * 按 matchedRule 归组给建议（放宽/收紧/确认 reason）。
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

// 观察 → 组键：suspicious 有实际观测行为；ignored 按规则模式归组（同 pattern 一条建议）
interface PolicyObservation {
  groupKey: string
  summary: string
  fields: string[]
}

export function collectPolicyObservations(ctx: AgentContext): PolicyObservation[] {
  const groups = new Map<string, PolicyObservation>()
  const push = (groupKey: string, summary: string, fieldPath: string): void => {
    const g = groups.get(groupKey)
    if (g) g.fields.push(fieldPath)
    else groups.set(groupKey, { groupKey, summary, fields: [fieldPath] })
  }
  // suspicious：疑似假覆盖（dump/console 探针等）→ 建议收紧（转 ignored 或加 reason 说明）
  for (const f of ctx.report.suspiciousCoverage) {
    push(`suspicious:${f.matchedRule?.pattern ?? 'no-rule'}`, 'suspicious coverage evidence — consider tightening matching or documenting reason', f.fieldPath)
  }
  // ignored：按 reason 归组 —— 建议用户确认这些忽略是否仍符合预期（可能该收紧回覆盖）
  for (const f of ctx.report.ignoredReturnedFields) {
    const pattern = f.matchedRule?.pattern ?? 'builtin-default'
    push(`ignored:${pattern}`, `ignored by rule (reason: ${f.matchedRule?.reason ?? 'none documented'}) — confirm this ignore is still intended`, f.fieldPath)
  }
  return [...groups.values()]
}

export function planPolicyTasks(ctx: AgentContext): AgentPlan {
  return {
    tasks: collectPolicyObservations(ctx).map((o) => ({
      type: 'suggest-policy' as const,
      groupKey: o.groupKey,
      summary: o.summary,
      fields: o.fields,
      reason: `${o.fields.length} field(s): ${o.summary}`,
    })),
  }
}

// 任务类型补充字段（AgentTask 联合在此模块扩展 —— 见 types.ts render/suggest/... 注记）
export interface SuggestPolicyFields {
  fields: string[]
  groupKey: string
  summary: string
}

export function buildPolicyPrompt(task: AgentTask & SuggestPolicyFields, ctx: AgentContext): string {
  return [
    'You are advising on Coverage Policy of a frontend project.',
    `Observation group: ${task.groupKey} — ${task.summary}`,
    `Affected fields: ${task.fields.join(', ')}`,
    '',
    'Produce a policy suggestion (advice only — never auto-modify config): propose a coverage: entry change (pattern / reason) or state explicitly that the current policy is correct.',
    '',
    ctx.policySummary,
    '',
    'Output exactly one fenced ```diff code block containing a unified diff (git format) against nx-mk.config.yml, or a diff with no changes plus a comment if no change is warranted. No explanations outside the block.',
  ].join('\n')
}

export async function applyPolicyTasks(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult> {
  const results: TaskApplyResult[] = []
  for (const task of plan.tasks) {
    if (task.type !== 'suggest-policy' || !('fields' in task)) continue
    try {
      const out = await ctx.ai.edit({
        instructions: buildPolicyPrompt(task as AgentTask & SuggestPolicyFields, ctx),
        context: { groupKey: task.groupKey, summary: task.summary, fields: (task as unknown as SuggestPolicyFields).fields },
      })
      results.push({ task, status: 'diff-produced', diffText: out.diffText })
    } catch (err) {
      results.push({ task, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { results }
}

export function createPolicyAgent(): CoverageAgentPlugin {
  return defineCoverageAgent({
    name: 'policy-agent',
    version: '0.1.0',
    capabilities: ['plan', 'apply'],
    plan: async (ctx) => planPolicyTasks(ctx),
    apply: applyPolicyTasks,
  })
}
