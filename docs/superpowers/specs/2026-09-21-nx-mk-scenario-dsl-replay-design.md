# nx-mk Spec: §26 DSL 运行器 → Replay Scenario（Scenario DSL + run 套件执行 + dashboard 回放）

> 日期：2026-09-21
> 范围：新包 @nx-mk/scenario（Scenario DSL schema/loader/runner/playwright 驱动/回放留痕）、config `scenarios:` 段、`nx-mk run` 套件执行模式（trace 打 scenarioId/dslStepId）、dashboard GET /api/scenarios + POST /api/runs/:runId/replay/scenario/:scenarioId + /scenarios 页
> 不在范围：click/fill/assertVisible 步骤（表单流 demo 出现再加）；[Export DSL]/[Copy curl]（§27.3 另两钮，推 v2 dsl-agent §35.3 域）；CLI scenario 子命令（dashboard 已覆盖，YAGNI）；SSE event-tail 映射新事件；DSL agent 自动生成场景
> 关联文档：
> - `docx/plan/nx-mk-plan.md` §26（DSL 设计原文）、§27（Replay 两类 + 安全等级）、§10（scenarios.include/concurrency 配置原文）、§8（packages/scenario/ 文件树锚点）、§35.3（dsl-agent，v2）
> - Phase 4.5 代码现状：`packages/dashboard/src/server/replay.ts`（request replay 全链）、`packages/plugin-playwright/src/runner.ts`（launchCollect 单页模式）、`scanner.ts`（drainBrowserCollector = 回捞+清空页内缓冲）

---

## 1. 目标与裁定记录

### 1.1 一句话

用户在 `mk/scenarios/*.yml` 手写 Scenario DSL，`nx-mk run` 按套件并发执行产出带 scenarioId/dslStepId 的 trace 与 field hits，dashboard `/scenarios` 页一键回放任一场景并看步骤级结果。

### 1.2 用户裁定记录（2026-09-21 三问三答）

| # | 问题 | 裁定 |
|---|---|---|
| S1 | 本期范围 | **全链 MVP**：DSL 运行器 + run 套件执行 + dashboard 只读浏览 + POST replay/scenario 单条回放（+45±10 测试，约 Phase 4 规模） |
| S2 | MVP step 集合（§26.3 列 8 种） | **5 种**：goto / waitFor / waitForRequest / assertFieldVisible / screenshot——§26.1 示例全可表达、demo 页面全覆盖；read-only 流零危险面 |
| S3 | Replay Scenario 执行体 | **server 端执行**：dashboard 加 `@nx-mk/scenario` workspace 依赖，POST 同步执行单场景，模块级串行锁（进行中 → 409）；trail 落 `.nx-mk/replays/scenarios/` |

### 1.3 本期设计裁定（spec 级）

| # | 裁定 | 理由 / 代价 |
|---|---|---|
| S4 | 新包 `packages/scenario`（@nx-mk/scenario），五文件按计划 §8 树：dsl-schema / dsl-loader / runner / playwright-runner / scenario-replay；依赖方向 **plugin-playwright → scenario**；`hasChromium` 探针从 plugin-playwright 迁入（plugin-playwright re-export 向后兼容） | §8 原文锚点；避免 plugin-playwright 膨胀；request replay 留在 dashboard 不动 |
| S5 | `waitForRequest.urlPattern` = **零依赖子串匹配**（对 trace.url 做 `includes`） | regex/glob 对用户是过度表达力；demo 场景 `/api/users` 级粒度够用 |
| S6 | 归因机制：每步执行后 `drainBrowserCollector`（既有"回捞+清空页内缓冲"语义天然支持增量），drain 出的 trace 打 `{scenarioId, dslStepId}` 后入共享 collector；`waitForRequest` 步显式等待到的请求**精确**打该步 dslStepId，其余步间增量只打 scenarioId（dslStepId null）；`RequestTraceCore` 增 optional `scenarioId?/dslStepId?`，coverage db INSERT 扩两列 | scenarioId/dslStepId 两列（Phase 2 起恒 NULL）首次有值；B7"原子读+清"由既有 drain 语义覆盖 |
| S7 | 覆盖语义零改动：每次 goto 后跑既有 PAGE_SCAN 扫描产 field hits/evidence（coverage 分析链不动）；`assertFieldVisible` 结果**只进 scenario trail**，不进三来源 | 字段可见性证据已由 DOM 扫描覆盖；assert 进 evidence 会涟漪 analyzer/db，v1 不做 |
| S8 | 失败语义：单步失败（超时/断言失败）→ 该场景 fail-fast、`ok:false` + 已完成步骤结果；其余场景继续；**run 退出码仍 0**，末尾 warn 汇总失败场景清单（evidence 通道包容先例） | `--strict` 严格模式推 v2；断言失败静默度由 warn 汇总兜底 |
| S9 | turn/事件语义：每场景完成 → `snapshot(turn++)` 走既有 emitReport 通道；新增 kernel 事件 `scenario:start`/`scenario:done`（union 扩展）；SSE event-tail 本期不映射 | 既有 goal-loop/snapshot 机制零改动复用 |
| S10 | 并发真实实现：单 browser 多 context，`concurrency` 默认 3、上限 10（§10 原文口径） | playwright 多 context 原生支持；无并发实现则 §10 配置成摆设 |
| S11 | `GET /api/scenarios` 数据源：dashboard 侧 loadConfig（configPath 接线，v1 写回链已铺）+ loadScenarios；config 缺 scenarios 段 → `{enabled: false, scenarios: []}` 诚实降级 | 与 GET /api/plugins 的 stale 降级同族 |
| S12 | 回放安全：5 种 step 全 read-only → verdict **恒 safe**，无 confirm 门 | click/fill 未入集（S2）；未来加写型 step 时安全分级随行引入 |
| S13 | `hasChromium` 缺失：run 套件模式 fail-fast（对齐 legacy collect 既有 PLUGIN_HOOK_FAILED 语义）；replay API → 409 `chromium not available` | 同一探测，两种场景两种反应（run 是采集主链路不能静默空转） |

## 2. 架构

### 2.1 数据流

```
【run 套件模式】nx-mk run（config.scenarios.include 非空）
  plugin-playwright beforeRun 分叉：
    loadScenarios(cwd, include) → 0 命中 → warn + 回落 legacy collect（E4）
    → browser 启动（hasChromium fail-fast，E3）→ 并发度 min(concurrency, 场景数) 个 context
    → 每场景：scenario:start 事件 → 步进执行（goto/waitFor/waitForRequest/assertFieldVisible/screenshot）
       每步后 drainBrowserCollector → trace 打 {scenarioId, dslStepId} → 共享 collector
       goto 后 PAGE_SCAN 扫描 → field hits/evidence（语义与 legacy 完全一致）
    → 场景完成 snapshot(turn++) → scenario:done 事件
    → 全部结束：失败清单 warn 汇总（S8），退出码 0

【Replay】dashboard /scenarios 页 [Replay] → POST /api/runs/:runId/replay/scenario/:scenarioId
  串行锁检查（进行中 409）→ chromium 检查（缺失 409）→ loadScenarios 定位（404）
  → 新 browser 单场景同步执行（同 runner）→ 步骤级结果
  → scenario-replay 写 .nx-mk/replays/scenarios/<scenarioId>/<replayId>.json（S12 trail）
  → 200 {replayId, scenarioId, ok, steps: [{stepId, type, ok, durationMs, error?}], createdAt}
```

### 2.2 包改动面

```
packages/scenario/            # 新包（§8 树五文件 + __tests__）
  dsl-schema.ts               # ScenarioFileSchema：version/scenarios[]{id,name,route?,steps[]} + 5 种 step zod union
  dsl-loader.ts               # loadScenarios(cwd, includeGlobs)：glob 匹配（复用 coverage/policy/glob，导出化）+ yaml 解析 + 去重 + 形状门跳过
  runner.ts                   # 纯逻辑：runScenario(steps, driver, hooks) 步进 + fail-fast + 每步 drain 钩子
  playwright-runner.ts        # StepDriver 的 playwright-core 实现 + hasChromium（自 plugin-playwright 迁入）
  scenario-replay.ts          # ScenarioReplayTrail 形状 + 写盘（铁律：dashboard server 白名单不动，写者在本包）
packages/config/src/          # ScenarioConfigSchema {include?: string[], concurrency?: int 1-10} + Config.scenarios? + 导出
packages/client/src/collector/collector.ts  # RequestTraceCore + scenarioId?/dslStepId?
packages/coverage/src/db/client.ts          # request_traces INSERT 扩 scenario_id/dsl_step_id 两列
packages/coverage/src/policy/glob.ts        # 匹配器导出化（index.ts re-export）
packages/kernel/src/            # 事件 union + scenario:start/scenario:done
packages/plugin-playwright/src/ # beforeRun 套件模式分叉 + drainBrowserCollector 归因插桩 + hasChromium 迁出 re-export
packages/dashboard/src/
  shared/api-types.ts           # ScenarioView/ScenariosResponse/ScenarioReplayResponse
  server/routes/scenarios.ts    # GET /api/scenarios + POST replay/scenario（串行锁 + 409/404 矩阵）
  server/index.ts               # registerScenarioRoutes
  ui/pages/Scenarios.tsx        # 列表 + [Replay] + 步骤级结果表（node renderToString 测试）
  ui/router.tsx                 # PageId 'scenarios' + /scenarios + 导航项
packages/cli/src/commands/run.ts  # 透传（collect 分叉在 plugin 内，CLI 只需把 scenarios 段随 config 流下去——预计零改动或极小）
```

### 2.3 API 增量

```
GET  /api/scenarios                                          # ✅ 本期（S11 降级语义）
POST /api/runs/:runId/replay/scenario/:scenarioId            # ✅ 本期（§27/§33 原文兑现）
POST /api/runs/:runId/replay/request/:requestId              # 既有（4.5），不动
[Export DSL] [Copy curl]（§27.3 另两钮）                      # ❌ 推 v2（dsl-agent §35.3）
```

## 3. 错误处理

| # | 场景 | 行为 |
|---|---|---|
| E1 | 场景文件形状非法 / 重复 id | loader 跳过 + warn（run 不 fail）；replay API 对该 id 404 |
| E2 | scenarios.include glob 0 命中 | warn + 回落 legacy collect（向后兼容软着陆） |
| E3 | chromium 缺失（run） | 套件模式 fail-fast PLUGIN_HOOK_FAILED（对齐 legacy collect） |
| E4 | chromium 缺失（replay API） | 409 `chromium not available` |
| E5 | 单步失败（waitFor 超时 / waitForRequest 超时 / assertFieldVisible 不可见 / screenshot IO 失败） | 场景内 fail-fast，`ok:false`，已完成步骤保留；其余场景继续 |
| E6 | replay 进行中再点 | 409 `scenario replay already in progress`（模块级串行锁） |
| E7 | scenarioId 不存在 | 404 `unknown scenario: <id>` |
| E8 | run 期场景失败汇总 | 全部结束后 console.warn 失败清单；退出码 0（S8） |
| E9 | trail 写盘失败 | 静默返回 null（对齐 request replay 留痕先例），API 响应不受影响 |

## 4. 测试策略

| 层 | 要点 |
|---|---|
| dsl-schema | 5 种 step 解析 / 非法 step 拒绝 / version 门 / 重复 id 检出 |
| dsl-loader | glob 匹配（含 `**`）/ 多文件合并去重 / 形状非法跳过 / 0 命中 |
| runner（假 StepDriver） | 步进顺序 / fail-fast 中断 / 每步 drain 钩子调用 / waitForRequest 归因精确性 |
| playwright-runner（mock page） | 5 种 step 各自驱动调用 + urlPattern 子串匹配 + 超时路径 |
| 套件模式 | 套件与 legacy 分叉 / 并发调度 / trace 归因字段落入 collector / E2 回落 / E8 汇总 |
| db | INSERT 两列有值（scenarioId/dslStepId 首次非 NULL） |
| 路由 | GET 降级矩阵 + POST 锁 409 / 404 / chromium 409 / trail 形状 |
| UI | Scenarios 页渲染 + Replay 结果表（renderToString） |

预计 +45±10 测试（当前 588 → ~633±10）。

## 5. 验收

1. 全套 vitest 绿（588 → ~633±10）+ `pnpm -r typecheck` 零回归
2. demo 手动验收：demo config 加 `scenarios: {include: [mk/scenarios/*.yml]}` + 示例场景（goto /users/1 → waitFor profile → assert user.name/email → screenshot）→ `nx-mk run` 产出带 scenarioId/dslStepId 的 trace + field hits 不回归 → dashboard /scenarios 列出场景 → Replay → 步骤级全绿 trail → `.nx-mk/replays/scenarios/` 落盘
3. 铁律 grep：dashboard server fs 写白名单仍恰 `replay.ts` 1 文件（scenario trail 写者在 @nx-mk/scenario）
4. 向后兼容：无 scenarios 段 config → legacy collect 行为分毫不差（既有全绿即证）；scenario_id/dsl_step_id 列缺省 NULL 不破旧 run 查询
5. D2：零新增外部依赖（glob 复用 coverage 匹配器、yaml/playwright-core 均 lockfile 既有，经 workspace 链解析）

## 6. 实现裁定记录（SDD 执行期，2026-09-21）

- **SP1**（修订 §2.2）：文件路径 glob 由 scenario 包自实现 `globToRegExp`（`**` 跨段、`*` 单段、其余字面转义、`/` 与 `\` 分隔符等价）——coverage 的 `matchGlob` 是点段（字段路径）语义，不同源不共用。
- **SP2**：step `id` optional，缺省 `${scenarioId}-step-${index}`（0 基）。
- **SP3**：套件 turn = `ctx.getTurn()` 取一次，逐场景 `collector.snapshot(turn)` 增量幂等 flush；goal-loop 机制零改动。
- **SP4**：浏览器生命周期全封装 scenario 包（`replayLaunch` seam 缺省真实现）；dashboard 永不 import playwright-core。实际依赖面：dashboard 新增 workspace 依赖 `@nx-mk/scenario` + `@nx-mk/kernel`（LoadConfigInput 需 runId: RunId）。
- **SP5/SP7**：waitForRequest 步 drain 带精确 dslStepId；失败步 drain 不带（失败时刻无法确认归因）；谓词 = URL 子串包含。
- **SP6 + 接口演进**：`SuiteObservers.afterStep` 执行期扩为三参 `(scenarioId, tag, page)`——plugin 需要 page 做 drain evaluate；scenario 包测试同步更新（2 参 mock 回调仍可赋值）。
- **SP8**：replay 的 runId 仅用于路由一致性（POST `unknown run` 404 门，UI 取 `/api/runs` 最新 runId 回填）；trail 实际落 `replays/scenarios/<scenarioId>/<replayId>.json`，场景与 run 无强绑定（§2.1 落盘路径原文维持）。
- **S9**：kernel 事件 `scenario:start/done` 入 union，SSE event-tail 不映射（default 臂吸收，前瞻兼容已核验）；legacy collect 路径机械抽取为 `legacyCollect` 字节级等价（14 既有测试零改动全绿）。
- **S8/E8**：场景失败不 fail run——warn 汇总失败 id 清单，退出码 0；`--strict` 推 v2。
- **S11**：GET /api/scenarios 三重诚实降级（configPath 缺 / 无 scenarios 段 / loadConfig 抛）→ 200 `{enabled:false, scenarios:[]}`。
- **S12**：5 种 step 全 read-only → replay 恒 safe 无 confirm 门；temperature 0 写型 step 未来随安全分级引入。
- 执行期实测：`%2F` 编码 scenarioId 路径参数正常匹配；loader 对畸形 YAML 文件跳过 + warn（E1）；kebab 场景 id 门天然防 path traversal。
- 终态：**635/635 测试（588 + 47）+ typecheck 15 包全绿**；铁律 grep：dashboard server 写白名单恰 `replay.ts` 1 文件。

### demo 手动验收物料（SP9，用户手动步骤，不改 examples/ 仓库文件）

**1. 场景文件** `mk/scenarios/user-profile.yml`（demo 项目根）：

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
        field: user.profile.name
      - id: assert-user-email
        type: assertFieldVisible
        field: user.profile.email
      - id: shot
        type: screenshot
```

**2. demo config**（nx-mk.config.yml）追加段：

```yaml
scenarios:
  include:
    - "mk/scenarios/**/*.yml"
  concurrency: 3
```

**3. 动作序列**：`pnpm demo:codegen`（或起 demo app + `nx-mk run`）→ 确认 events.jsonl 见 `scenario:start/done`、run 尾部无异常 warn → dashboard `/scenarios` 列出 user-profile-basic → 点 Replay → 步骤表 5 行全 pass + 「trail written」→ 核对 `.nx-mk/replays/scenarios/user-profile-basic/<replayId>.json` 落盘 → `request_traces` 表 `scenario_id/dsl_step_id` 非空。
