/**
 * C8 多 agent 接线（§33/§32.2）：runtime agents[] multi-plan / per-task apply 路由。
 * - LoopDeps.agents: CoverageAgentPlugin[]（替代单 apiUiAgent；至少一个非 verify-only agent）
 * - plan：所有 agent 依序 plan 合并 backlog（保序：agent 顺序 × 各自任务序）
 * - apply：批次 task 按 owner（来源 agent）路由 —— 跨 agent 任务混合进同批不串线
 * - 默认接线 = [api-ui]（CLI loop.ts 按 config.agent.agents 白名单构造）→ 行为不回归
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { runAgentLoop } from '../runtime.js'
import { taskIdOf, type AgentTask, type CoverageAgentPlugin, type AgentContext, type AgentApplyResult } from '../types.js'
import { makeReport, OK_PROVIDER, scriptedReview } from './fixtures.js'

/** 常量任务替身 agent：plan 返回固定 tasks；apply 逐 task 产 done/failed 并广播轨迹 */
function fakeAgent(name: string, tasks: AgentTask[], onApply?: (task: AgentTask, agent: string) => void): CoverageAgentPlugin {
  return {
    name, version: '0.0.1', capabilities: [],
    plan: async () => ({ tasks }),
    apply: async (_ctx, plan): Promise<AgentApplyResult> => ({
      results: plan.tasks.map((t) => {
        onApply?.(t, name)
        return { task: t, status: 'diff-produced' as const, diffText: `--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b (${name})` }
      }),
    }),
  }
}

const FIELD_TASKS: AgentTask[] = [
  { type: 'render-field', fieldId: 'field_0', fieldPath: 'data.f0', endpointId: 'getUsers', reason: 'missing' },
  { type: 'render-field', fieldId: 'field_1', fieldPath: 'data.f1', endpointId: 'getUsers', reason: 'missing' },
]
const ENDPOINT_TASK: AgentTask = { type: 'add-api-call', endpointId: 'getUsers', method: 'GET', path: '/users', reason: 'never called' }
const POLICY_TASK: AgentTask = { type: 'suggest-policy', groupKey: 'suspicious:foo', summary: 'too loose', fields: ['data.x'], reason: 'advice' }

function root(): string {
  return mkdtempSync(join(tmpdir(), 'nx-mk-c8-'))
}

describe('runAgentLoop — multi-agent (C8)', () => {
  it('两个 agent 的任务合并 backlog，apply 按来源路由（同批混合不串线）', async () => {
    const r = root()
    const routeLog: { agent: string; taskId: string }[] = []
    const uiAgent = fakeAgent('api-ui-agent', FIELD_TASKS, (t, a) => routeLog.push({ agent: a, taskId: taskIdOf(t) }))
    const clientAgent = fakeAgent('api-client-agent', [ENDPOINT_TASK], (t, a) => routeLog.push({ agent: a, taskId: taskIdOf(t) }))
    const summary = await runAgentLoop(
      { projectRoot: r, report: makeReport(2), config: { loop: { maxTasksPerIteration: 8 } } },
      { provider: OK_PROVIDER, agents: [uiAgent, clientAgent], reviewAgent: scriptedReview(() => 'pass') },
    )
    expect(summary.stoppedBy).toBe('backlog-empty')
    expect(summary.produced).toBe(3)
    // 路由：render-field 两个落到 api-ui-agent，add-api-call 落到 api-client-agent
    expect(routeLog.filter((e) => e.agent === 'api-ui-agent').map((e) => e.taskId).sort()).toEqual(['field_0', 'field_1'])
    expect(routeLog.filter((e) => e.agent === 'api-client-agent').map((e) => e.taskId)).toEqual(['add-api-call:getUsers'])
  })

  it('plan 失败的 agent 被跳过（E 容错：一个 agent 坏不废整轮）', async () => {
    const r = root()
    const bad: CoverageAgentPlugin = {
      name: 'bad-agent', version: '0.0.1', capabilities: [],
      plan: async () => { throw new Error('plan-boom') },
      apply: async () => ({ results: [] }),
    }
    const good = fakeAgent('api-ui-agent', FIELD_TASKS)
    const summary = await runAgentLoop(
      { projectRoot: r, report: makeReport(2), config: {} },
      { provider: OK_PROVIDER, agents: [bad, good], reviewAgent: scriptedReview(() => 'pass') },
    )
    expect(summary.produced).toBe(2)
    expect(summary.stoppedBy).toBe('backlog-empty')
  })

  it('空 agents 数组 → 直接 fail-fast（KERNEL_INTERNAL）', async () => {
    const r = root()
    await expect(runAgentLoop(
      { projectRoot: r, report: makeReport(1), config: {} },
      { provider: OK_PROVIDER, agents: [], reviewAgent: scriptedReview(() => 'pass') },
    )).rejects.toThrow(/no agents/i)
  })
})

// —— 内置注册表（§33 白名单接线用，CLI loop.ts 消费）——
describe('builtinAgent registry', () => {
  it('白名单五中文名 → 工厂；review-agent 不在表；未知名 undefined', async () => {
    const { builtinAgentFactories, BUILTIN_AGENT_NAMES } = await import('../agents/index.js')
    expect(BUILTIN_AGENT_NAMES).toEqual(['api-ui-agent', 'api-client-agent', 'dsl-agent', 'policy-agent'])
    for (const n of BUILTIN_AGENT_NAMES) {
      const a = builtinAgentFactories[n]?.()
      expect(a?.name).toBe(n)
    }
    expect(builtinAgentFactories['review-agent']).toBeUndefined()
    expect(builtinAgentFactories['nope']).toBeUndefined()
  })
})
