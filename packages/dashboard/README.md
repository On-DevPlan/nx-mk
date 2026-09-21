# `@nx-mk/dashboard`

> 本地分析台 —— fastify server（只读 API + 少量写操作）+ React UI

## 概述

本包提供 `nx-mk start` 背后的本地 web 分析台：server 从 `.nx-mk/` 读取 run 产物
（`coverage.db` readonly + `coverage-report.json` + runs 目录），UI 每 5 秒轮询刷新。

UI 是手写 hash router + React，页面路径全在 `#/` 之后 —— server 永远只见 `/`。

## 启动

```bash
cd <你的项目>
node ../../packages/cli/dist/index.js start
```

- 默认 `http://127.0.0.1:4317`，`--port` 覆盖，config `dashboard.port` / `dashboard.open` 可配
- 先起 server 再自动跑一次分析；`--no-run` 只服务已有产物
- run 失败时 server 不关，failed run 仍可见

## 页面

| 路径 | 页面 |
|---|---|
| `#/` | Overview —— 最新 run 三指标 |
| `#/runs` | Runs 列表 |
| `#/runs/:runId` | run 总览 |
| `#/runs/:runId/requests`、`#/runs/:runId/requests/:requestId` | 请求列表 / 详情（含 field hits 与 UI evidence 文本样本、Replay 按钮） |
| `#/runs/:runId/fields` | Fields 四态列表 |
| `#/runs/:runId/ignored` | Returned-but-ignored |
| `#/runs/:runId/manifest` | endpoints 表 + schema 字段表 + policy 徽章 |
| `#/settings/plugins` | 插件卡片、YAML 片段、config 编辑器（Preview → Apply） |

## API

只读路由：

```
GET  /api/runs                                    run 列表
GET  /api/runs/:runId                             run 详情
GET  /api/runs/:runId/metrics                     三指标 + 计数
GET  /api/runs/:runId/requests                    请求列表
GET  /api/runs/:runId/requests/:requestId         请求详情
GET  /api/runs/:runId/fields                      字段四态
GET  /api/runs/:runId/ignored                     returned-but-ignored
GET  /api/runs/:runId/manifest                    manifest 浏览
GET  /api/runs/:runId/replays                     request replay 留痕列表
GET  /api/plugins                                 插件卡片 + manifest
GET  /api/events                                  SSE：stage/agent 事件流（curl -N 可看）
```

写操作（Phase 4.5 / v1 引入）：

```
POST   /api/runs/:runId/replay/request/:requestId     复刻请求（safe GET 直接执行；unsafe 需 confirm，否则 409）
PATCH  /api/plugins/:pluginName/config                两段式配置写回（dryRun 缺省 true；dryRun=false + yamlSha 落盘）
```

## 写路径铁律

server 的 fs 写入白名单**恰一个文件**：`src/server/replay.ts`。除此之外：

- `PATCH /api/plugins/:pluginName/config` 不直接写文件 —— 它调用 `@nx-mk/config` 的
  `writeback.ts`（`nx-mk.config.yml` 的唯一写者）
- 新增写盘需求必须落在**写者所在的包**，不得扩 server 白名单

## 数据读取

- `coverage.db` 以 **readonly** 打开（`src/server/store/db-reader.ts`）
- 报告与 run 元信息读 `coverage-report.json` / runs 目录
- config 与插件 manifest 经 `loadConfig` + plugins manifest 读取，config 缺失时**诚实降级**
  （如 `GET /api/plugins` 返回 stale 标记而非报错）

## 依赖

`@nx-mk/config`、`@nx-mk/coverage`、`better-sqlite3`、`fastify`；UI 侧 React 19（含 `renderToString` 测试）。

## 测试

```bash
pnpm test
```

覆盖：路由全矩阵（含 PATCH 错误码映射）、store 读取、UI 页 `renderToString`、poller 与 router 纯函数。

## 设计参考

- spec：[`2026-09-17-nx-mk-phase4-dashboard-design.md`](../../docs/superpowers/specs/2026-09-17-nx-mk-phase4-dashboard-design.md)、
  [`2026-09-20-nx-mk-phase45-dashboard-ops-design.md`](../../docs/superpowers/specs/2026-09-20-nx-mk-phase45-dashboard-ops-design.md)、
  [`2026-09-20-nx-mk-v1-plugin-config-writeback-design.md`](../../docs/superpowers/specs/2026-09-20-nx-mk-v1-plugin-config-writeback-design.md)
