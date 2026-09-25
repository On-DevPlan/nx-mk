# `@nx-mk/plugin-playwright`

> 采集插件 —— headless chromium DOM 扫描 + Goal Loop 报告上报

## 概述

本包是 nx-mk 的采集执行体：启动 headless chromium 打开目标页面，扫描 `[data-mk-field]` 标记，
把字段命中与请求 trace 上报给 Goal Loop，并落盘到 SQLite。

与内核的关系：内核的 Plugin 合约只有 `before{Phase}` / `after{Phase}` 钩子（无裸 `run` 钩子），
因此 v0 把**单次收集通路**放在 `beforeRun` 中执行：

```
beforeRun → goto(url) → scanPage(等待 waitForSelector 就绪)
          → collector.evidence / field-hit 直报（emitReport）
          → drainBrowserCollector（回捞页内缓冲 → 共享 collector）
          → collector.snapshot(turn) 产出 endpoint-called
```

## v0 语义要点

- **单次收集，不按 `maxTurns` 循环** —— 收集完成后 `emitSignal({ kind: 'done', reason: 'all-collected' })`
  声明完成，Goal Loop 据此 all-done 早停；`maxTurns` 字段保留，供后续版本启用逐 turn 驱动
- **报告双通道**：扫描到的 DOM 字段直接以 `field-hit` 报给 Goal Loop（过 manifest
  `normalizedPath` 校验集，见下）；`endpoint-called` 来自 `collector.snapshot(turn)`
  （浏览器侧 trace 的增量，method/path 恒在）。不为 DOM 字段伪造 `collector.hit` ——
  那会污染经 drain → SQLite 落盘的共享通道
- **manifest 接线**（原 Ruling 8，已落地）：`beforeRun` 读 `.nx-mk/manifest.json`（与 kernel
  initial-coverage 同路径语义）—— ① DOM 直报的 `dataMkField` 必须命中 manifest
  `normalizedPath` 集（与 Goal Loop missing 项同键域，spec §3.1 id-space 对齐），垃圾
  fieldId 不再进 Goal Loop；② 注入 `window.__MK_MANIFEST__`，demo SDK（`@nx-mk/client`
  runtime）浏览器侧 `matchEndpoint` 据此解析真实 endpointId。manifest 缺席（未配 openapi
  等）降级为 warn 一次 + 不校验直报
- **浏览器侧 shim**（`COLLECTOR_SHIM_SCRIPT`）：经 `addInitScript` 注入 `window.__MK_COLLECTOR__`
  单通道，业务代码在 analysis 模式下写入 hit / trace；页面工作完成后由 `drainBrowserCollector`
  回捞（读 + 清）进共享 collector，**先于** `snapshot`
- 已知限制：整页导航会重置页内缓冲，未回捞的 hit / trace 即丢（`addInitScript` 是 per-document 语义）；
  demo 无整页导航，v0 接受

## 采集目标优先级

`resolveCollectTarget()` 的优先级链：

```
plugins 列表中本插件的对象条目 config  →  顶层 collect: 段  →  工厂 opts（CLI 装配注入）
```

```ts
import { createPlaywrightPlugin, resolveCollectTarget } from '@nx-mk/plugin-playwright'

export default createPlaywrightPlugin({ url: 'http://localhost:5173' })
```

| 选项 | 说明 |
|---|---|
| `url` | 目标应用地址（`config.collect.url` 缺省时的回退） |
| `waitForSelector` | 页面就绪选择器，默认 `'[data-mk-field]'` |
| `maxTurns` | 保留字段，v0 不循环强制 |
| `collector` | 注入的共享 collector；缺省由插件自建 |

对应配置：

```yaml
plugins:
  - name: '@nx-mk/plugin-playwright'
    config: { url: http://localhost:5173, waitForSelector: '[data-mk-field]' }
```

条目 config 经插件声明的 `configSchema`（`{ url?, waitForSelector? }`）校验 —— 仅 config
声明路径生效；CLI 的 `extraPlugins` 代码装配不经 `loadPlugins`，无此校验。

## 导出

`createPlaywrightPlugin`、`resolveCollectTarget`、`PlaywrightPluginOptions`、`CollectTarget`，
以及默认导出 `createPlaywrightPluginDefault`（零参工厂）。

## 环境要求

需要本机有可用的 chromium 可执行文件，`hasChromium()` 提供探测。未安装时：

```bash
npx playwright install chromium
```

## 依赖

`@nx-mk/kernel`（插件合约）、`@nx-mk/client`（collector）、`@nx-mk/coverage`（落盘）、
`@nx-mk/manifest-schema`（manifest 类型）、`zod`（configSchema）、`playwright-core`。

## 测试

```bash
pnpm test
```

## 设计参考

- spec：[`2026-09-16-nx-mk-phase2-collection-design.md`](../../docs/superpowers/specs/2026-09-16-nx-mk-phase2-collection-design.md)（§3.4）
- 配套包：`@nx-mk/coverage`（trace / evidence 落库与策略判定）
