/**
 * @nx-mk/agent —— coverage-gap Agent Loop（suggest-diff 模式，spec §1）
 */
export {
  defineCoverageAgent,
  type AgentTask,
  type AgentPlan,
  type TaskApplyResult,
  type AgentApplyResult,
  type AgentVerifyResult,
  type AgentContext,
  type CoverageAgentPlugin,
  type AgentEditInput,
  type AgentEditOutput,
  type AgentProvider,
  type AgentConfig,
  type AgentProviderConfig,
  type AgentLoopConfig,
} from './types.js'

export {
  extractDiff,
  sanitizeFieldSlug,
  writePatchFile,
  toPosixRel,
  gitApplyCheck,
  type GitApplyFn,
  type GitRunResult,
} from './patches.js'

export {
  READONLY_ALLOWED_TOOLS,
  defaultRunClaude,
  classifyClaudeSpawnError,
  createClaudeCodeProvider,
  type RunClaudeFn,
  type RunClaudeResult,
  type ClaudeCodeProviderOptions,
} from './provider/claude-code.js'

export {
  addedLines,
  verifyDiff,
  createReviewAgent,
  type ApplyCheckFn,
} from './agents/review.js'

export {
  planTasks,
  buildPrompt,
  applyTasks,
  createApiUiAgent,
} from './agents/api-ui.js'
