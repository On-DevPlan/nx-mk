---
name: nx-mk-plugins
description: Use when writing a new nx-mk plugin or working on packages/plugin-playwright (chromium 采集驱动） / packages/plugin-swagger —— 插件契约、addInitScript 注入、scanner/runner、endpointId unknown fallback. Progressive disclosure with refs to plan sections and code map.
---

# nx-mk plugins

插件契约与两个内置插件实现。主干导航，插件协议与各插件细节在 references/。

## 板块边界

`packages/plugin-playwright/src/`（index/runner/scanner）+ `packages/plugin-swagger/src/`（index）+ kernel 插件契约侧（契约本身见 [[nx-mk-kernel-core]]）。插件本质：实现 kernel hooks（§14 契约）并在 plugins-manifest 登记可装配面。

## 插件铁律（勿改）

- 插件只经 kernel plugin-registry 装配，禁止 kernel 直接 import 插件（§14 裁决双向成立）
- 新插件五件套：实现 kernel 契约 → plugins-manifest 登记 → plugin-schema 测试 → per-run manifest 读路径（dashboard plugins-reader）→ demo 装配验证
- Ruling 8（plugin-playwright/src/index.ts 头注释）：endpointId 落 'unknown' fallback 是 v0 已知限制，修它是 plan 层决策

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[playwright-采集]] | 动 chromium 采集驱动、addInitScript 注入、scanner/runner 时 | references/playwright-采集.md |
| [[swagger-插件]] | 动 manifest 到 swagger 视图/插件注册时 | references/swagger-插件.md |
| [[plugins-code-map]] | 定位两个插件包与反射契约的落点 | references/plugins-code-map.md |

## 校验

`corepack pnpm --filter @nx-mk/plugin-playwright build && corepack pnpm --filter @nx-mk/plugin-swagger build`；playwright 插件改动需 chromium 可执行 + Phase 3 验收链（[[nx-mk-cli-config]] [[build-验收]]）。
