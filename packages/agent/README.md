# `@nx-mk/agent`

> coverage-gap Agent Loop —— 把覆盖率缺口转成建议 diff（suggest-diff 模式）

## 概述

本包消费最新一轮的 `.nx-mk/coverage-report.json`，把 **missing required 字段**分批交给本地
`claude` CLI，产出 unified diff，经静态 review guard 后落 `.nx-mk/patches/<agentRunId>/`。

**全程不写工作区文件**（suggest-diff 模式，D1 决策）：补丁由使用者人工 `git apply` 后重跑 `nx-mk run` 验证。

```bash
nx-mk run          # 先产出 coverage report
nx-mk loop         # 产 diff → .nx-mk/patches/<agentRunId>/
git apply .nx-mk/patches/<agentRunId>/*.patch
nx-mk run          # 验证 requiredCoverage 真实提升
```

> 含 `/` 的字段 id 生成的补丁文件名可能带子目录，shell 通配用
> `find .nx-mk/patches/<id> -name '*.patch'` 更稳。

## 一轮迭代做什么

```
批次（maxTasksPerIteration）→ provider 产 diff → 落盘终稿
  → review guard 静态校验 → reject 则留档 rename → agent_iterations 落库
  → 终止判定
```

provider 与 agent 均经 `LoopDeps` 注入，runtime 不感知 `spawn`（便于测试替身）。

终止原因（`LoopSummary.stoppedBy`）：

| 值 | 含义 |
|---|---|
| `backlog-empty` | missing required 字段已处理完（补丁待人工 apply 验证） |
| `no-improvement` | 连续 `stopIfNoImprovementRounds` 轮无改善 |
| `max-iterations` | 达到 `maxIterations` 上限 |

`LoopSummary` 另含本轮统计：`agentRunId`、`iterations`、`produced`、`rejected`、`failed`、`givenUp`、`patchDir`（相对 projectRoot）。

## 导出

| 分组 | 符号 |
|---|---|
| 装配 | `defineCoverageAgent`、`CoverageAgentPlugin`、`AgentContext`、`AgentTask`、`AgentPlan` |
| 运行时 | `runAgentLoop`、`resolveAgentConfig`、`AGENT_DEFAULTS`、`makeAgentRunId`、`renderManifestSummary`、`renderPolicySummary` |
| provider | `createClaudeCodeProvider`、`defaultRunClaude`、`READONLY_ALLOWED_TOOLS`、`classifyClaudeSpawnError` |
| 内置 agent | `createApiUiAgent`（`planTasks` / `buildPrompt` / `applyTasks`）、`createReviewAgent`（`verifyDiff` / `addedLines`） |
| 补丁 | `extractDiff`、`sanitizeFieldSlug`、`writePatchFile`、`toPosixRel`、`gitApplyCheck` |

## 默认值

```ts
AGENT_DEFAULTS = {
  provider: { timeoutMs: 300_000, maxTurns: 8 },
  loop: { maxIterations: 5, stopIfNoImprovementRounds: 2, maxTasksPerIteration: 5 },
}
```

config 无 `agent:` 段时即用这套默认值。可配：

```yaml
agent:
  provider: { type: claude-code, timeoutMs: 300000, maxTurns: 8 }
  loop: { maxIterations: 5, stopIfNoImprovementRounds: 2, maxTasksPerIteration: 5 }
```

## 前置与环境

- 本地已安装并**登录** `claude` CLI
- provider 只授只读工具（`READONLY_ALLOWED_TOOLS`：Read / Grep / Glob）—— agent 没有写文件通道，
  产物只能经 diff 回传
- 缺失 claude CLI → `KernelError(PROVIDER_UNAVAILABLE)`（退出码 2）

## 依赖

`@nx-mk/kernel`（错误类型与生命周期）、`@nx-mk/coverage`（读 report 与 `agent_iterations` 落库）、
`better-sqlite3`。

## 测试

```bash
pnpm test
```

覆盖：provider spawn 与超时/缺失分类、review guard（`verifyDiff` / `addedLines`）、补丁落盘与 slug 清洗、
runtime loop 全流程与终止判定。

## 设计参考

- spec：[`2026-09-18-nx-mk-phase5-agent-design.md`](../../docs/superpowers/specs/2026-09-18-nx-mk-phase5-agent-design.md)
- 方案 §32-§38（Agent 设计 / SDK / Provider / 内置插件 / 权限模型 / Loop / 终止与回滚）
