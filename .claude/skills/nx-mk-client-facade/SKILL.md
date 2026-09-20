---
name: nx-mk-client-facade
description: Use when working on packages/client —— SDK Facade codegen、collector/tracked-proxy 采集注入、patchGlobalFetch 兜底、migrate 静态迁移、Field 组件 UI-evidence、analysis mode. Progressive disclosure with refs to plan sections and code map.
---

# nx-mk client-facade

SDK Facade 与浏览器端采集注入。主干导航，采集协议与迁移细节在 references/ 按需加载。

## 板块边界

`packages/client/src/` 七个子模块：codegen / collector / migrate / mode / proxy / react / runtime。不含采集驱动器（plugin-playwright 见 [[nx-mk-plugins]]），不含 coverage 判定（见 [[nx-mk-coverage-analysis]]）。

## 链路主干（勿改顺序）

1. `codegen/generate-sdk.ts` 从 manifest 生成 SDK Facade（emit-endpoint / emit-types）
2. `runtime/patch.ts` 提供 `patchGlobalFetch()` 兜底拦截；`proxy/create-tracked-proxy.ts` 按文档重放采集
3. `collector/collector.ts` 缓冲 field_hits / ui_evidence / request_traces 三表数据回捞
4. `mode/analysis.ts` 由 vite define `__MK_ANALYSIS__` 烘焙开关（⚠️ 改 env 起效：define 在 dev server 启动时烘焙，`MK_ANALYSIS=true` 给 vite 进程不是 CLI）
5. `react/Field.tsx` 显式 Field 标记 → UI evidence（§20）
6. `migrate/engine.ts` 静态 fetch 替换（`npx nx-mk migrate`）

## 设计时本人裁决红线

- shim 按文档重放：整页导航重置 `window.__MK_COLLECTOR__` 缓冲、未回捞即丢——v0 接受（README 已知限制），跨导航持久化是 Phase 4+ 议题，不要顺手改
- patch.ts 与 plugin-playwright 的 addInitScript 形成注入契约，改一侧必须同步另一侧

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[facade-codegen]] | 动 SDK 生成、emit 模板、codegen 输出契约前 | references/facade-codegen.md |
| [[runtime-instrumentation]] | 动 fetch/shim/proxy 拦截、缓冲回捞协议前 | references/runtime-instrumentation.md |
| [[client-code-map]] | 在 client 七个子模块定位行为落点 | references/client-code-map.md |

## 校验

改 client 后：`corepack pnpm --filter @nx-mk/client build`，再跑 `pnpm demo:codegen` 验证一键闭环产出 `app/src/generated-sdk.ts`。
