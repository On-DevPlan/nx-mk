---
name: nx-mk-plugins
description: Use when writing a new nx-mk plugin or working on packages/plugin-playwright (chromium 采集驱动） / packages/plugin-swagger —— 插件契约、addInitScript 注入（collector + manifest shim）、scanner/runner、emitSignal 终态上报. Progressive disclosure with refs to plan sections and code map.
---

# nx-mk plugins

插件契约与两个内置插件实现。主干导航，插件协议与各插件细节在 references/。

## 板块边界

`packages/plugin-playwright/src/`（index/runner/scanner/manifest）+ `packages/plugin-swagger/src/`（index）+ kernel 插件契约侧（契约本身见 [[nx-mk-kernel-core]]）。插件本质：实现 kernel hooks（§14 契约）并在 plugins-manifest 登记可装配面。

## 插件铁律（勿改）

- 插件只经 kernel plugin-registry 装配，禁止 kernel 直接 import 插件（§14 裁决双向成立）
- 新插件五件套：实现 kernel 契约 → plugins-manifest 登记 → plugin-schema 测试 → per-run manifest 读路径（dashboard plugins-reader）→ demo 装配验证
- 原 Ruling 8 已落地（2026-09-25，feat/plan-align-batch2）：plugin-playwright beforeRun 读 `.nx-mk/manifest.json` —— DOM dataMkField 过 normalizedPath 校验集（与 Goal Loop missing 键域同域）+ 注入 `window.__MK_MANIFEST__`（endpointId 不再 'unknown'）；manifest 缺席降级 warn 一次
- 采集完成须 `emitSignal({kind:'done'})`：kernel goal-loop 据此 all-done 早停（信号由 hook 运行器归因 plugin 名，插件不填）

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[playwright-采集]] | 动 chromium 采集驱动、addInitScript 注入、scanner/runner 时 | references/playwright-采集.md |
| [[swagger-插件]] | 动 manifest 到 swagger 视图/插件注册时 | references/swagger-插件.md |
| [[plugins-code-map]] | 定位两个插件包与反射契约的落点 | references/plugins-code-map.md |

## 校验

`corepack pnpm --filter @nx-mk/plugin-playwright build && corepack pnpm --filter @nx-mk/plugin-swagger build`；playwright 插件改动需 chromium 可执行 + Phase 3 验收链（[[nx-mk-cli-config]] [[build-验收]]）。
