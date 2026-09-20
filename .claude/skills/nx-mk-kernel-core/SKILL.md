---
name: nx-mk-kernel-core
description: Use when working on packages/kernel (微内核、event-bus、goal-loop、plugin 注册、RunState) or debugging run 终止/goal 判定/plugin 装配问题. Provides progressive disclosure via refs to plan 设计意图 and 代码地图.
---

# nx-mk kernel-core

微内核与 Run 生命周期。本 skill 是主干导航——具体协议与行号地图在 references/，按需加载。

## 板块边界

覆盖 `packages/kernel/src/`，运行时骨架（不含插件实现，见 [[nx-mk-plugins]]；不含采集注入，见 [[nx-mk-client-facade]]）。

## 核心流程（固定主干，勿改）

1. `kernel.ts` 装配 plugin-registry → `kernel-runtime.ts` 驱动 Pipeline §13
2. `event-bus.ts` 单总线发布运行时事件（events.jsonl 落盘由 cli 侧消费）
3. `goal-loop.ts` 每轮 turn 后读 coverage 三指标 → goal 判定 → `terminated_by`
4. 初始化时 `initial-coverage.ts` 预填 baseline 指标

错误模型：`errors.ts` 统一 MkError 分级；日志走 `logger.ts`。RunState 形状定在 `types.ts`。

## 设计仲裁

遇到实现疑问，按顺序：§44 核心设计原则 > 对应章节裁决段落 > 现有代码事实。

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[pipeline-arch]] | 改 Pipeline 阶段顺序、新增 lifecycle 钩子前 | references/pipeline-arch.md |
| [[runstate-events]] | 动 RunState 字段、events.jsonl 事件 schema、消费端 poller 对齐前 | references/runstate-events.md |
| [[goal-loop-协议]] | 调 goal 判定逻辑、三指标取数、terminated_by 枚举 | references/goal-loop-协议.md |
| [[kernel-code-map]] | 在 kernel 内定位某个行为的落点（文件/行号） | references/kernel-code-map.md |

## 校验

改 kernel 后必须：`corepack pnpm --filter @nx-mk/kernel build && corepack pnpm --filter @nx-mk/kernel test`。kernel 是下游依赖，破坏即全链路红。
