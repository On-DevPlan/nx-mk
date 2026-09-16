# mk

> OpenAPI-driven frontend API/UI coverage analyzer with SDK Facade

通过 `npx mk` 一键启动本地分析工作台：解析 OpenAPI → 生成 Manifest → 注入 SDK Facade → 采集 request/field-hit/UI-evidence → 计算 coverage → 写报告。

## 当前状态

**Phase 1.5 完成** — SDK Facade Codegen（SDK-CG1/CG2/CG3）+ demo 闭环打通。
下一步：Phase 2 采集（runtime proxy / collector / Playwright / SQLite trace store / UI evidence v0）。

demo 闭环：`pnpm demo:codegen` 一键跑 `demo:openapi` → `nx-mk run`（plugin-swagger → manifest.json）→ codegen → `app/src/generated-sdk.ts`。存量代码迁移：`npx nx-mk migrate`（静态 fetch 替换）+ `patchGlobalFetch()`（兜底）。

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