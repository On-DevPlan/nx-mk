---
name: nx-mk-cli-config
description: Use when working on packages/cli —— run/start/init/doctor/migrate/loop 命令编排、构建依赖顺序、watch 模式、CI 后置决策、demo 验收步骤. Progressive disclosure with refs to plan sections and code map.
---

# nx-mk cli-config

CLI 命令编排与工程构建。主干导航，命令协议与构建顺序在 references/。

## 板块边界

`packages/cli/src/commands/` 六命令（run / start / init / doctor / migrate / loop）+ index.ts 门面；watch/CI 模式（plan §39-40）为设计后置项。不含命令内部调用的包逻辑（kernel/coverage/client 各归其 skill）。

## 命令主干（勿改语义）

- `run`（run.ts）：load config → fail-fast 探测（未起 vite/后端即报错，spec §4）→ 驱动 kernel + Goal Loop → 产物落 `.nx-mk/`
- `start`（start.ts）：一次起 dashboard 全套（Phase 4 入口）
- `migrate`（migrate.ts）：静态 fetch 替换（实现委托 [[nx-mk-client-facade]] migrate/engine.ts）
- `init` / `doctor`（init.ts / doctor.ts）：脚手架与环境诊断
- `loop`（loop.ts）：goal 未达成的多轮重试编排

## 构建铁律

无 turbo，依赖顺序固定：client → coverage → kernel → config → plugin-playwright → cli（README Phase 3 step 0 逐字为准）。

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[commands-协议]] | 动命令 flag、fail-fast、退出码、events 驱动前 | references/commands-协议.md |
| [[build-验收]] | 改构建顺序、demo 验收、watch/CI 后置项时 | references/build-验收.md |
| [[cli-code-map]] | 定位 cli 行为落点 | references/cli-code-map.md |
