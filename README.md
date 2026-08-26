# mk

> OpenAPI-driven frontend API/UI coverage analyzer with SDK Facade

通过 `npx mk` 一键启动本地分析工作台：解析 OpenAPI → 生成 Manifest → 注入 SDK Facade → 采集 request/field-hit/UI-evidence → 计算 coverage → 写报告。

## 当前状态

**Phase 0 进行中** — 项目骨架 + 微内核（插件机制 + 生命周期）

完整方案见 [`docx/plan/mk-plan.md`](./docx/plan/mk-plan.md)。
完整 spec 见 [`docs/superpowers/specs/2026-08-26-mk-foundation-and-sdk-design.md`](./docs/superpowers/specs/2026-08-26-mk-foundation-and-sdk-design.md)。

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