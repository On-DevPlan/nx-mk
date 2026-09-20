---
name: nx-mk-dashboard
description: Use when working on packages/dashboard —— server 只读路由、SQLite/manifest reader、ui 轮询 poller、页面组件、PluginSettings YAML 片段、Replay. Progressive disclosure with refs to plan sections and code map.
---

# nx-mk dashboard

Phase 4+ 工作台：只读 server + 轮询 ui。主干导航，页面与路由细节在 references/。

## 板块边界

`packages/dashboard/src/`：server（路由 + store 读取）/ ui（React 页面）/ shared（api-types 共享契约）。不含落库（见 [[nx-mk-coverage-analysis]]），不含 run 驱动（`nx-mk start` 由 cli 发起，见 [[nx-mk-cli-config]]）。

## 架构主干（勿改）

- server 全部只读：从 `.nx-mk/coverage.db`（store/db-reader.ts + queries.ts）与 per-run manifest（store/plugins-reader.ts）读，不写任何分析数据
- ui 走轮询通道（R11 裁决：poller.ts 保留 polling，SSE/WS 后置）；实时刷新以 useEventSource 兑换 replay 行为准（b50383b 已实现形态）
- shared/api-types.ts 是 server↔ui 唯一契约——改路由响应必须先改这里
- 页面路由在 router.tsx 接线；PluginSettings 只输出 YAML 片段（18ecad2 形态，不直接写 config）

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[server-read-routes]] | 新增/修改 /api 路由、reader 查询前 | references/server-read-routes.md |
| [[ui-pages]] | 动页面组件、路由接线、useEventSource 消费前 | references/ui-pages.md |
| [[dashboard-code-map]] | 定位 dashboard 行为落点 | references/dashboard-code-map.md |

## 校验

`corepack pnpm --filter @nx-mk/dashboard build`；手动验收步骤见 README Dashboard 段。
