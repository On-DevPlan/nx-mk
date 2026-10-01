/**
 * 内置 agent 注册表（C8 / §33 白名单接线）：CLI loop.ts 按 config.agent.agents
 * 白名单查表构造实例。review-agent 不进表（verify-only，runtime 作为 deps.reviewAgent
 * 单独装配），dl-agent/policy 仅在白名单中出现。
 */
import { createApiUiAgent } from './api-ui.js'
import { createApiClientAgent } from './api-client.js'
import { createDslAgent } from './dsl.js'
import { createPolicyAgent } from './policy.js'
import type { CoverageAgentPlugin } from '../types.js'

export type BuiltinAgentFactory = () => CoverageAgentPlugin

export const BUILTIN_AGENT_NAMES = ['api-ui-agent', 'api-client-agent', 'dsl-agent', 'policy-agent'] as const

export const builtinAgentFactories: Record<string, BuiltinAgentFactory> = {
  'api-ui-agent': createApiUiAgent,
  'api-client-agent': createApiClientAgent,
  'dsl-agent': createDslAgent,
  'policy-agent': createPolicyAgent,
}
