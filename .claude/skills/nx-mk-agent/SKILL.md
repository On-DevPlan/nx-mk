---
name: nx-mk-agent
description: Use when working on packages/agent —— Agent Runtime loop、claude-code provider、api-ui/review 内置 agent、D1 权限 patches、终止/回滚. Progressive disclosure with refs to plan sections and code map.
---

# nx-mk agent

Agent SDK + Runtime + Provider + 内置 agents（plan §32-38）。主干导航，loop 协议与权限细节在 references/。

## 板块边界

`packages/agent/src/`：runtime.ts（SDK loop）、provider/claude-code.ts、agents/{api-ui,review}.ts（两个内置 agent）、patches.ts（D1 权限）、types.ts。不含 goal 判定（kernel 侧，见 [[nx-mk-kernel-core]]），不含 CLI 编排（见 [[nx-mk-cli-config]]）。

## 架构主干（勿改）

- Agent Loop：runtime.ts 驱动 turn → provider 调 claude-code → 工具调用流回；终止判定双通道（正常完成 / 超时或连续失败，§38 终止与回滚）
- 内置 agent 二选一挂接：api-ui.ts（API↔UI coverage 修复）与 review.ts（结果审查）——新增 agent 先登记 plan §35 表再实现
- provider/claude-code.ts 是唯一 provider 实现（§34），MVP 不抽象多 provider
- patches.ts 对齐 D1 权限模型（§36）：agent 工具调用必须经 patches 白名单收敛

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[agent-loop]] | 动 turn loop、终止/回滚、集成点前 | references/agent-loop.md |
| [[provider-d1]] | 动 provider 调用、权限 patches、事件对齐前 | references/provider-d1.md |
| [[agent-code-map]] | 在 agent 包定位行为落点 | references/agent-code-map.md |

## 校验

`corepack pnpm --filter @nx-mk/agent build`，必跑 __tests__ 全量（runtime-loop / runtime-terminate / patches / sdk 是协议改动必跑）。
