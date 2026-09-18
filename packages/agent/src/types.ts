/**
 * agent-sdk 协议类型（spec §3.4 —— 唯一事实源；plan §33 的收缩版，差异见 spec 附注 A）。
 *
 * suggest-diff 铁律（D1）：全链路零工作区写入 —— agent 只产出 diff 文本，
 * 落盘目标仅 .nx-mk/patches/；可应用性验证 = git apply --check（不落盘）。
 */
import type { CoverageReport } from '@nx-mk/coverage'

// 协议再出口（EXEC-4）：AgentContext.report 内嵌 CoverageReport —— types.ts 是 SDK 唯一事实源，
// 消费方（含 T7 runtime）应能从本模块取到该类型，不必直依赖 @nx-mk/coverage。
export type { CoverageReport } from '@nx-mk/coverage'

// 任务：v0 只有 render-field 一种；字段级 diff 粒度
export interface AgentTask {
  type: 'render-field'
  fieldId: string           // FieldCoverageItem.fieldId
  fieldPath: string
  endpointId: string | null // FieldCoverageItem.endpointId ?? null
  reason: string            // missing / weak-evidence 等人读理由
}

export interface AgentPlan { tasks: AgentTask[] }

// 逐 task 的 apply 结果：diff 文本或失败原因（不抛异常，错误即结果）。
// patchRelPath 由 runtime 落盘后回填（PLN-2：guard 的 G1 需要落盘文件）
export interface TaskApplyResult {
  task: AgentTask
  status: 'diff-produced' | 'failed'
  diffText?: string        // status=diff-produced 时存在
  error?: string           // status=failed 时的人读原因
  patchRelPath?: string    // 相对 projectRoot 的 posix 路径；runtime 回填
}

export interface AgentApplyResult { results: TaskApplyResult[] }

// review verdict：静态 guard（review-agent）的产出
export interface AgentVerifyResult {
  verdict: 'pass' | 'reject'
  checks: { name: string; outcome: 'pass' | 'reject' | 'skipped'; detail?: string }[]
}

// §33 收缩版上下文（R8：manifest/policy 摘要由 report 派生为文本）
export interface AgentContext {
  report: CoverageReport      // 只读输入（@nx-mk/coverage 类型直用）
  manifestSummary: string     // R8
  policySummary: string       // R8
  projectRoot: string         // nx-mk.config.yml 所在目录（claude cwd / git apply cwd）
  ai: AgentProvider
  log: (msg: string) => void
}

// §33 逐字形状（capabilities 收为 string 别名；verify 可选 —— PLN-6）
export interface CoverageAgentPlugin {
  name: string
  version: string
  capabilities: string[]
  plan(ctx: AgentContext): Promise<AgentPlan>
  apply(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult>
  verify?(ctx: AgentContext, result: AgentApplyResult): Promise<AgentVerifyResult>
}

// SDK 入口：恒等函数（类型收口用，与内核 definePlugin 同风格）
export function defineCoverageAgent(plugin: CoverageAgentPlugin): CoverageAgentPlugin {
  return plugin
}

// §34 收缩版：v0 仅 edit 通道（generate/review 不收，见 spec 附注 A）
export interface AgentEditInput {
  instructions: string
  context?: Record<string, unknown>   // 渲染进 prompt 的结构化上下文
}
export interface AgentEditOutput { diffText: string }
export interface AgentProvider {
  name: string
  edit(input: AgentEditInput): Promise<AgentEditOutput>
}

// ---------------------------------------------------------------------
// config `agent:` 段镜像（PLN-3：kernel 不新增类型；单一事实源在
// @nx-mk/config 的 zod schema —— 此处形状必须与其保持一致）
// ---------------------------------------------------------------------
export interface AgentProviderConfig {
  type: 'claude-code'
  timeoutMs?: number
  maxTurns?: number
}
export interface AgentLoopConfig {
  maxIterations?: number
  stopIfNoImprovementRounds?: number
  maxTasksPerIteration?: number
}
export interface AgentConfig {
  provider?: AgentProviderConfig
  loop?: AgentLoopConfig
}

// ---------------------------------------------------------------------
// runtime 入口（LoopDeps 为注入缝；claude adapter 在 CLI 装配层构造，runtime 不感知 spawn）
// ---------------------------------------------------------------------
export interface LoopDeps {
  provider: AgentProvider
  apiUiAgent: CoverageAgentPlugin
  reviewAgent: CoverageAgentPlugin    // 其 verify() 即 guard
}
export interface LoopOptions {
  projectRoot: string
  report: CoverageReport
  config: AgentConfig                 // 原始可选段；默认值由 runtime 回填
  log?: (msg: string) => void
}
export interface LoopSummary {
  agentRunId: string
  iterations: number
  produced: number
  rejected: number
  failed: number
  givenUp: number
  patchDir: string                    // 相对 projectRoot
  stoppedBy: 'backlog-empty' | 'max-iterations' | 'no-improvement'
}
