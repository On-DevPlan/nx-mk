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

- **单次收集，不按 `maxTurns` 循环** —— 循环终止交由 Goal Loop 的 `idleTurnsLimit` / `maxTurns` 决定；
  选项中的 `maxTurns` 字段保留，供后续版本启用逐 turn 驱动
- **报告双通道**：扫描到的 DOM 字段直接以 `field-hit` 报给 Goal Loop；`endpoint-called` 来自
  `collector.snapshot(turn)`（浏览器侧 trace 的增量）。不为 DOM 字段伪造 `collector.hit` ——
  那会污染经 drain → SQLite 落盘的共享通道
- **浏览器侧 shim**（`COLLECTOR_SHIM_SCRIPT`）：经 `addInitScript` 注入 `window.__MK_COLLECTOR__`
  单通道，业务代码在 analysis 模式下写入 hit / trace；页面工作完成后由 `drainBrowserCollector`
  回捞（读 + 清）进共享 collector，**先于** `snapshot`
- 已知限制：整页导航会重置页内缓冲，未回捞的 hit / trace 即丢（`addInitScript` 是 per-document 语义）；
  demo 无整页导航，v0 接受
- `endpointId` 可能落 `'unknown'` fallback（manifest 未注入浏览器）

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

## 导出

`createPlaywrightPlugin`、`resolveCollectTarget`、`PlaywrightPluginOptions`、`CollectTarget`，
以及默认导出 `createPlaywrightPluginDefault`（零参工厂）。

## 环境要求

需要本机有可用的 chromium 可执行文件，`hasChromium()` 提供探测。未安装时：

```bash
npx playwright install chromium
```

## 依赖

`@nx-mk/kernel`（插件合约）、`@nx-mk/client`（collector）、`@nx-mk/coverage`（落盘）、`playwright-core`。

## 测试

```bash
pnpm test
```

## 设计参考

- spec：[`2026-09-16-nx-mk-phase2-collection-design.md`](../../docs/superpowers/specs/2026-09-16-nx-mk-phase2-collection-design.md)（§3.4）
- 配套包：`@nx-mk/coverage`（trace / evidence 落库与策略判定）
