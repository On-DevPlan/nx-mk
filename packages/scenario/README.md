# `@nx-mk/scenario`

> Scenario DSL 运行器与回放 —— 文件加载 + 纯逻辑步进 + playwright 驱动 + Replay 留痕

## 概述

本包是 nx-mk 的「§26 场景 DSL 执行 + 场景回放」层，五块职责：

| 模块 | 入口 | 职责 |
|---|---|---|
| DSL 形状 | `ScenarioFileSchema` / `ScenarioStepSchema` | version 1 文件门 + 5 种 step discriminated union |
| 发现加载 | `loadScenarios` / `globToRegExp` | include 路径段 glob → YAML 解析 → 形状门 → 同 id 去重（首个胜出） |
| 纯逻辑执行 | `runScenario` / `runScenarioSuite` | 步进 + fail-fast + 每步 drain 归因；并发 worker 池调度 |
| 浏览器驱动 | `createPlaywrightDriver` / `runScenarioWithPage` / `runScenarioSuiteInBrowser` / `hasChromium` | 5 step → playwright-core 映射；observers 缝；单 browser 多 context 池 |
| 回放 | `replayScenario` / `writeScenarioReplayTrail` | 单场景回放（不进 coverage 通道）+ trail 落盘 |

分层要点：`runner.ts` 是**不含浏览器**的纯逻辑（`StepDriver` 接口注入），浏览器生命周期全部内聚在
`playwright-runner.ts` / `scenario-replay.ts`（SP4）—— 因此 dashboard 永不 `import playwright-core`。

## DSL（方案 §26.1）

```yaml
version: 1
scenarios:
  - id: user-profile-basic
    name: 用户详情页基础覆盖
    route: /users/1
    steps:
      - id: open-user-profile
        type: goto
        url: http://localhost:5173/users/1
      - id: wait-profile
        type: waitFor
        selector: "[data-page='user-profile']"
      - id: assert-user-name
        type: assertFieldVisible
        field: data.name
      - id: shot
        type: screenshot
```

MVP 5 种 step（§26.3 的 `click` / `fill` / `assertVisible` **后置**，等表单流 demo 出现再加）：

| type | 必填 | 语义 |
|---|---|---|
| `goto` | `url` | `page.goto(url, { waitUntil: 'networkidle' })` |
| `waitFor` | `selector` | `waitForSelector` |
| `waitForRequest` | `urlPattern` | `waitForRequest`，谓词是 **URL 子串包含**（SP5） |
| `assertFieldVisible` | `field` | 等 `[data-mk-field="<field>"]` 进入 `state: 'visible'` |
| `screenshot` | —（`path` 可选） | 全页截图 |

约束：

- `id`（场景）必须是 kebab-case（`^[a-z0-9][a-z0-9-]*$`），天然挡住 path traversal
- `steps` 数量 1–50；step 的 `id` 可省，缺省 `${scenarioId}-step-${index}`（0 基，SP2）
- 每步 `timeoutMs` 可省，缺省 15000，上限 60000

## 加载语义（E1）

- `include` 是**文件路径** glob：`**` 跨段、`*` 单段、`/` 与 `\` 等价、其余字符字面转义；
  `**/` 允许匹配零段（即直连同目录文件）
- 与 `@nx-mk/coverage` 的 `matchGlob` **不同源不共用** —— 后者是点段（字段路径）语义（SP1）
- 不可解析的 YAML / 形状非法文件 → **跳过并记入 `skipped[]`**，不抛（run 不 fail）
- 重复 scenario id → 首个胜出，后者记入 `skipped[]`
- `include` 0 命中 → 由调用方（plugin-playwright）回落 legacy collect，向后兼容软着陆

## 执行语义

- 每步执行后调 `driver.drain(tag)`；`waitForRequest` 步的 drain 带精确 `dslStepId`，
  失败步**不带**（失败时刻无法确认归因，SP5/SP7）——该 tag 最终落到 `request_traces.scenario_id` / `dsl_step_id`
- 任一步失败 → 场景内 fail-fast，已完成步骤保留，返回 `{ ok: false, steps }`；
  **场景失败不 fail run**（warn 汇总失败清单，退出码 0，S8/E8）
- `SuiteObservers` 两个缝：`afterGoto`（DOM 扫描 / field-hit 上报）、`afterStep`（collector 回捞 + 归因打标），
  后者透传 `page` 供 `page.evaluate` 使用（SP6）
- 套件池：单个 browser + 逐场景 `newContext()`；`initScripts` **必须先于 `newPage()`** 注入
  （collector shim 通道由 plugin 提供，本包不知道 shim 内容，SP10/S4）
- chromium 缺失：run 套件模式 fail-fast（对齐 legacy collect）；replay 抛
  `ScenarioReplayError('CHROMIUM_MISSING')`

## 回放与留痕

- `replayScenario(scenario)`：单 context + page 跑一遍，**不接 observers** —— replay 不进 coverage 通道（S7）
- 5 种 step 全 read-only → replay **恒 `safe`，无 confirm 门**（S12）
- `replayLaunch` 是可替换的 launch 缝（单测免真浏览器；生产缺省真 `chromium.launch()`）
- trail 落 `<.nx-mk>/replays/scenarios/<scenarioId>/<replayId>.json`，`replayId = <scenarioId>-<Date.now()>`
- trail 写盘失败**静默返回 `null`**，不影响 API 响应（E9，对齐 request replay 留痕先例）
- **写者在包外不破铁律**：dashboard server 的 fs 写路径白名单仍恰 `server/replay.ts` 1 个文件

## 集成点

| 位置 | 形态 |
|---|---|
| `@nx-mk/config` | 可选 `scenarios:` 段 —— `include: string[]`、`concurrency: 1..10`（缺省 3，由 plugin-playwright 兜底） |
| `@nx-mk/plugin-playwright` | `include` 非空 → 激活套件模式（逐场景 context），否则 legacy collect |
| `@nx-mk/dashboard` | `GET /api/scenarios`（三重诚实降级 → `200 {enabled:false, scenarios:[]}`）+ `POST /api/runs/:runId/replay/scenario/:scenarioId`（404 unknown run/scenario、409 串行锁 / chromium 缺失）+ `/scenarios` 页 |
| `@nx-mk/kernel` | 事件 `scenario:start` / `scenario:done` 入事件 union（SSE event-tail 不映射，default 臂吸收） |

## 用法

```ts
import { loadScenarios, runScenarioSuiteInBrowser, replayScenario } from '@nx-mk/scenario'

const { scenarios, skipped } = loadScenarios(cwd, ['mk/scenarios/**/*.yml'])
console.warn(skipped)   // 形状非法 / 重复 id 的文件，不抛

const results = await runScenarioSuiteInBrowser(scenarios.map((s) => s.scenario), {
  concurrency: 3,
  observers: { afterGoto, afterStep },
  initScripts: [COLLECTOR_SHIM_SCRIPT],   // shim 字面量归调用方（plugin）
})

const single = await replayScenario(scenarios[0]!.scenario)   // 无 observers，不进 coverage 通道
```

## 测试

```bash
pnpm test
```

依赖均为 lockfile 既有项（`playwright-core` / `yaml` / `zod`），未引入新外部包（D2）。

## 设计参考

- 设计 spec：[`docs/superpowers/specs/2026-09-21-nx-mk-scenario-dsl-replay-design.md`](../../docs/superpowers/specs/2026-09-21-nx-mk-scenario-dsl-replay-design.md)
- 实施计划：[`docs/superpowers/plans/2026-09-21-scenario-dsl-replay.md`](../../docs/superpowers/plans/2026-09-21-scenario-dsl-replay.md)
- 方案 §26（DSL 设计）、§27（Replay 设计）；采集侧配套包：`@nx-mk/plugin-playwright`
