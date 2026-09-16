# mk

> OpenAPI-driven frontend API/UI coverage analyzer with SDK Facade

通过 `npx mk` 一键启动本地分析工作台：解析 OpenAPI → 生成 Manifest → 注入 SDK Facade → 采集 request/field-hit/UI-evidence → 计算 coverage → 写报告。

## 当前状态

**Phase 2 采集完成** — runtime proxy / collector / plugin-playwright（headless chromium DOM 扫描 + 浏览器 collector 通道）/ SQLite trace store（§25 九表）/ CLI `run` 装配（Ruling 5 代码装配 + 共享 collector 单实例）。
下一步：Phase 3 分析（policy-engine 全量 / anti-cheat）。

- demo 闭环：`pnpm demo:codegen` 一键跑 `demo:openapi` → `nx-mk run`（plugin-swagger → manifest.json）→ codegen → `app/src/generated-sdk.ts`。存量代码迁移：`npx nx-mk migrate`（静态 fetch 替换）+ `patchGlobalFetch()`（兜底）。
- Phase 2 采集闭环（手动验收，见下）：`nx-mk run` 驱动 headless chromium 扫 demo 前端 → field_hits / ui_evidence / request_traces 三表落库。

完整方案见 [`docx/plan/nx-mk-plan.md`](./docx/plan/nx-mk-plan.md)。
本阶段 spec 见 [`docs/superpowers/specs/2026-09-16-nx-mk-phase2-collection-design.md`](./docs/superpowers/specs/2026-09-16-nx-mk-phase2-collection-design.md)。

### Phase 2 手动验收步骤（真实浏览器链路）

> 环境要求：chromium 可执行（未装 → `npx playwright install chromium`）。
> ⚠️ env 变量纠错：`MK_ANALYSIS=true` 给 **vite 进程**（define 在 dev server 启动时
> 烘焙 `__MK_ANALYSIS__`，重启生效），不是给 CLI 进程；CLI `run` 本体不做 fetch。

```bash
# 0. 按依赖顺序构建（无 turbo）：client → coverage → kernel → plugin-playwright → cli
corepack pnpm --filter @nx-mk/client build && corepack pnpm --filter @nx-mk/coverage build \
  && corepack pnpm --filter @nx-mk/kernel build && corepack pnpm --filter @nx-mk/plugin-playwright build \
  && corepack pnpm --filter @nx-mk/cli build

# 1. 起后端（8787）
corepack pnpm --filter @nx-mk-example/server dev &

# 2. 起前端（5173，MK_ANALYSIS=true 烘焙 analysis mode —— Ruling 6 缺省解析）
MK_ANALYSIS=true corepack pnpm --filter @nx-mk-example/app dev &

# 3. 起采集 run（demo 目录内，config.collect 已配）
cd examples/react-vite-demo
node ../../packages/cli/dist/index.js run

# 4. 验收断言（spec §1.4.1）：三表非空；sqlite3 缺失时可用 better-sqlite3 one-liner
sqlite3 .nx-mk/coverage.db "select count(*) from field_hits"
sqlite3 .nx-mk/coverage.db "select count(*) from ui_evidence"
sqlite3 .nx-mk/coverage.db "select count(*) from request_traces"
```

期望：单次收集通路后 run 正常完成（field_hits / ui_evidence / request_traces
三表落库）；未先起 vite/后端 → fail-fast（spec §4）。
注意：demo config 未配 `goal:` 段 → Goal Loop 不启用 —— v0 demo = beforeRun
一次收集 + run 终止，不发生多 turn 迭代（goal 驱动终止在 Phase 3 前不可测，
见下条 §1.4.2 延期注记）。
已知限制（v0 接受，Phase 3 修）：
- endpointId 落 'unknown' fallback（manifest 未注浏览器，Ruling 8 见
  `packages/plugin-playwright/src/index.ts` 头注释）。
- **goal 驱动终止延期**（§1.4.2，计划级记账）：goal-loop 断言
  的是 manifest stableFieldId（哈希）id 空间，而 DOM 直报 fieldId 是 dataMkField
  字符串，两者恒不相等 → coverage 永不匹配，field-hit goal-met 不可达；
  且 demo config 无 `goal:` 段（loop 未启用）、terminatedBy 未持久化。
  修法（goal 段接入 + normalizedPath 键域映射 + manifest 注入）排 Phase 3。
- shim 按文档重放：整页导航会重置 `window.__MK_COLLECTOR__` 缓冲，未回捞的
  hits/traces 即丢（addInitScript per-document 语义）；demo 无整页导航，v0 接受。

## 开发

```bash
pnpm install
pnpm build
pnpm test
```

## 包结构

```
packages/
├── kernel/                # @mk/kernel — 微内核（插件 + 事件 + 生命周期）
├── config/                # @mk/config — 配置 schema + loader
├── manifest/              # @mk/manifest — OpenAPI → Manifest（占位）
├── cli/                   # @mk/cli — npx mk 入口（占位）
└── plugin-swagger/        # @mk/plugin-swagger — OpenAPI 适配插件（占位）
```