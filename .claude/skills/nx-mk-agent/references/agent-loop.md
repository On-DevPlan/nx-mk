# Agent Loop 与内置 agents

plan 对应：§32 Agent 设计 + §33 Agent SDK + §35 内置 Agent 插件 + §37 Agent Loop + §38 Agent 终止与回滚。

## 主干

- loop 语义：runtime.ts 每 turn = provider 调用 + 工具执行 + 事件发布；终止双通道见 §38（正常完成 → terminated；异常 → 回滚判定，禁止静默残留）
- 内置 agent（§35 各条）：api-ui.ts 按 plan 表的字段清单驱动修复 loop；review.ts 输出审查事件——两者共享 runtime 但互不 import
- SDK 面（§33）：对外只暴露 runtime/types 的稳定入口（index.ts），provider 与 agents 是内部装配

## 代码落点

| 行为 | 文件 |
| --- | --- |
| loop 驱动 | packages/agent/src/runtime.ts |
| api-ui agent | packages/agent/src/agents/api-ui.ts |
| review agent | packages/agent/src/agents/review.ts |
| SDK 门面 | packages/agent/src/index.ts |

## 易错

- loop 事件名与 kernel event-bus union 对齐（[[nx-mk-kernel-core]] [[runstate-events]]）——改事件三处同步（agent 发、kernel 落、dashboard 读）
- 回滚语义见 §38 裁决，禁止把回滚当重试用
