# plugin-playwright 采集驱动

plan 对应：§18 Runtime Instrumentation（注入端）+ Ruling 8（index.ts 头注释）。

## 主干

- `runner.ts` 驱动 headless chromium 扫 demo 前端 → 三表数据（field_hits / ui_evidence / request_traces，Phase 2 采集闭环）
- 注入契约：addInitScript per-document 语义挂 `window.__MK_COLLECTOR__`（collector 实现在 [[nx-mk-client-facade]] [[runtime-instrumentation]]）——改一侧必须同步另一侧
- `scanner.ts` 从 UI 提取证据信号；`index.ts` 头注释是 Ruling 8 契约位（endpointId 'unknown' fallback）
- 整页导航重置 collector 缓冲（README 已知限制 v0 接受）——丢数据先查导航类型

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 注册/契约头注释 | packages/plugin-playwright/src/index.ts |
| chromium 驱动 | packages/plugin-playwright/src/runner.ts |
| UI 证据扫描 | packages/plugin-playwright/src/scanner.ts |

## 易错

- chromium 未装 → `npx playwright install chromium`（README 环境要求）
- demo 无整页导航，v0 缓冲语义在 demo 下从未被触发——不要以为它已验证
