/**
 * agent-sdk 协议冒烟（spec §3.4）：协议类型可满足 + defineCoverageAgent 恒等。
 */
import { describe, it, expect } from 'vitest'
import {
  defineCoverageAgent,
  type AgentApplyResult,
  type AgentContext,
  type AgentPlan,
  type AgentVerifyResult,
  type CoverageAgentPlugin,
} from '../types.js'

// 满足协议的最小插件（类型收口：任何字段缺失都会编译失败）
const fake: CoverageAgentPlugin = {
  name: 'fake',
  version: '0.0.1',
  capabilities: ['plan', 'apply'],
  plan: async (_ctx: AgentContext): Promise<AgentPlan> => ({ tasks: [] }),
  apply: async (_ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult> => ({
    results: plan.tasks.map((t) => ({ task: t, status: 'failed', error: 'not-implemented' })),
  }),
  verify: async (): Promise<AgentVerifyResult> => ({ verdict: 'pass', checks: [] }),
}

describe('defineCoverageAgent', () => {
  it('returns the same plugin object (identity)', () => {
    expect(defineCoverageAgent(fake)).toBe(fake)
  })

  it('accepts a plugin without optional verify', () => {
    const { verify: _verify, ...rest } = fake
    const bare: CoverageAgentPlugin = rest
    expect(defineCoverageAgent(bare).verify).toBeUndefined()
  })
})
