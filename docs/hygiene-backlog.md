# nx-mk 卫生 Backlog（hygiene backlog）

> 创建：2026-09-18（Phase 5 收尾后重建）
> 来源：Phase 3 终审 13 项（PR #9 描述压缩版）+ Phase 4 终审 13 项（PR #10 描述压缩版）+ 2026-09-18 对当前 master 逐项核实
> 状态图例：☐ 待修 / ☑ 已修（修完即划）
> 说明：本文件是这些非阻塞发现的**唯一持久记录**（各期 SDD 台账随验收清理删除）。修一项划一项。
> **2026-09-19 收尾更新：15 项全部 ☑（清零）。** 逐项 commit SHA 见「已修记录」。

---

## A 组 —— 2026-09-18 核实仍存在

| # | 条目 | 位置 | 核实依据 | 状态 |
|---|---|---|---|---|
| A1 | `kernel.ts` 超 400 行纪律（500 行，Phase 3 时 498） | `packages/kernel/src/kernel.ts` | `wc -l` = 500 | ☑ |
| A2 | `plugin-swagger` typecheck 失败 ×2：测试 fixture 落后 kernel 类型（缺 `pluginStates`、缺 `PluginContext` 的 emitReport/emitSignal/getTurn/getCoverage/getMissing） | `packages/plugin-swagger/src/__tests__/index.test.ts:38,42` | `tsc --noEmit` exit 2，两处 TS2741/TS2739 | ☑ |
| A3 | `Poller.start()` 不幂等：重复调用泄漏 interval | `packages/dashboard/src/ui/poller.ts:26` | 无 timer 判空 | ☑ |
| A4 | `Poller.refresh` 成功路径无 aborted 卫语句：被取代的旧响应仍可 `onUpdate` | `poller.ts:47` | 仅 catch 分支有卫语句 | ☑ |
| A5 | static 竞态 500：`existsSync` 与 `readFile` 之间文件消失 → 应 404 | `packages/dashboard/src/server/static.ts:49-52` | TOCTOU 窗口 | ☑ |
| A6 | MIME 扩展表不全，未知扩展一律 `application/octet-stream` | `static.ts:12` | 仅 3 项 | ☑ |
| A7 | 根 `esbuild ^0.27.0` override 卡死 demo app vite 构建（Phase 4 时 stash 证明非本期引入；dashboard 包自身以 `build.target: 'es2022'` 绕开） | 根 `package.json` | Phase 4 终审记录 | ☑ |

## B 组 —— 终审记录在案、位置已知、本次未逐一复核

| # | 条目 | 位置 | 出处 | 状态 |
|---|---|---|---|---|
| B1 | `coverage_fields` 与 field_hits/ui_evidence 三表写非原子（失败 run 部分落库） | `packages/coverage/src/analyzer/coverage-analyzer.ts:75` | Phase 3 终审 M3 | ☑ |
| B2 | analyzer `unknown` 分支零测试（生产可达：decision 缺失时 `status='unknown'`） | `coverage-analyzer.ts:85` | Phase 3 终审 T7 | ☑ |
| B3 | analyzer `startsWith` 弱判别（noise-guard 独立断言兜底） | analyzer | Phase 3 终审 T9 | ☑ |
| B4 | `METHOD_NAME_BLOCKLIST` own-property 语义（原型链方法误判） | `packages/client/src/proxy/create-tracked-proxy.ts:38` | Phase 3 终审 | ☑ |
| B5 | dashboard 测试 fixtures tmp 根泄漏 | dashboard tests | Phase 4 终审 | ☑ |
| B6 | 非 404 错误页仍显 loading 态 | dashboard UI | Phase 4 终审 | ☑ |
| B7 | `drainBrowserCollector` READ+CLEAR 非原子（多轮 turn 丢数据窗口） | client collector | Phase 3 终审 | ☑ |
| B8 | collector/proxy index re-exports 卫生 | client 包 | Phase 3 终审 | ☑ |

## 已修记录

> 分支：chore/hygiene-task1（测试/UI 微修批）、chore/hygiene-task2（类型/对齐批）、chore/hygiene-task3（核验/配置批，含 task1）；
> 收尾合并：chore/hygiene-task3 = task1 + task2 + task3 + 收尾新增（B2 单测、本落档）。全仓 vitest 502/502 绿 + plugin-swagger tsc exit 0。

| # | 已修内容 | commit |
|---|---|---|
| A1 | kernel.ts 500 → 241 行；阶段驱动机器抽出 kernel-runtime.ts（352 行），`KernelRuntimeDeps` 访问器缝注入，行零变化 | `a7d240e` |
| A2 | fixture 补 `pluginStates: new Map()` + PluginContext 五方法 stub；`tsc --noEmit` exit 0 | `44779ec` |
| A3 | `Poller.start()` 加 `if (this.timer !== null) return` 幂等卫语句 | `ad4007a` |
| A4 | refresh 成功路径 `if (controller.signal.aborted) return` 卫语句，被取代响应不再回调 | `ad4007a` |
| A5 | static 单次 `readFile` + `catch ENOENT → 404`，消除 TOCTOU（删 existsSync/statSync） | `928d020` |
| A6 | MIME 表 3 → 12 项（js/css/json/svg/png/jpg/ico/woff2/map 等） | `928d020`（+ `ab74e37` 补 .map 断言）**1** |
| A7 | override `^0.27.0` → `^0.25.0`（实验矩阵：0.27 demo 复现失败、0.25 全绿；≥ 0.25.0 保留 GHSA-67mh-4wv8-2f99 修复线）；lockfile 全量解析 0.25.12 | `808a99a` |
| B1 | coverage_fields 批量落库单事务（`db.transaction` 透传 + 无能力替身逐条 fallback，行为不变）；field_hits/ui_evidence 此前已在 `flushDrained` 内事务化 | `cb38b27`（+ `4cd314b` 用例拆分）**1** |
| B2 | analyzer unknown 分支单测：decision 缺失 → policy_status=unknown、不进两分母、未命中 → notApplicable（v0 行为锁定） | `e58d25f` |
| B3 | noise-guard 锁定：原型方法名字段占位判定仍为「样本===末段全等」，非 startsWith（3 测试 + anti-cheat 注释去误导） | `6c8fc04`（+ `4cd314b` 注释修正）**1** |
| B4 | 核实为非问题：classifier 侧无 startsWith 依赖；proxy 侧 blocklist 仅按 `in` 判定制造非代理值，own-property 语义差异不产 field_hits 噪声（v0 行为保持，见 4.5 备忘） | （核实记录，无代码变更） |
| B5 | 核实为已修复状态：dashboard fixtures 全部经 `mkdtempSync` + afterEach `rmSync` 清理（fixtures.ts 自 Task 2 起即 hermetic）；无裸 tmpdir 直写 | （核实记录，无代码变更） |
| B6 | 7 页统一非 404 错误态（`ApiError` instanceof 收窄 + `detailMessage`）+ 70 行页面测试 | `f4d998d` |
| B7 | document-only 落档：多轮 turn 共用脚本应单次 evaluate 读+清；结构性处理留 4.5 collector 重写 | `1c30f69` |
| B8 | 核实：client index re-exports 已显式（仅 `export *` 零处，均为具名导出）；B3 noise-guard 锁定后协议面稳定，无需改动 | （核实记录，无代码变更） |

**\*1** 挂靠主 commit 的审查 Minor 补充项（同分支追加 commit）。

## 4.5 备忘（~~遗留至 Phase 4.5 / 后续~~ → 2026-09-22 全部清零，PR #26）

- ☑ B4：`METHOD_NAME_BLOCKLIST` own-property 守则已落码（`create-tracked-proxy.ts` 名单注释：收窄前必重跑 anti-cheat B3 noise-guard 三测试）。
- ☑ B7：`drainBrowserCollector` READ+CLEAR 原子化已由 hygiene-sweep H8 落地（PR #25：DRAIN_SHIM 单次 evaluate 读+清，两 drain 测试零改动通过）。
- ☑ B1 审查 Minor：`AnalyzerDb.transaction?` 方法语法 → 属性函数类型 `transaction?: (fn: () => void) => () => void`（严格变型检查，结构形状不变，替身兼容）。
- ☑ v1 质量杠杆：ignored ids 进 prompt / policySummary 消费 —— `renderPolicySummary` 枚举 report 观测到的 ignored 字段路径（R8 约束保持：不读 manifest.json）；`buildPrompt` 接入 `ctx.policySummary`（原 v0 渲染后未消费）。

**至此本文档全部条目（A 组 7 + B 组 8 + 4.5 备忘 4）清零，backlog 归档。**

---

> **2026-09-25 重建**：Plan（`docx/plan/nx-mk-plan.md`）× master 逐节对照后新开 **C 组**（Plan 有、实现无的缺口）。
> 逐条裁定详情（含 Plan 出处）见 Plan **§47.4**；本表是操作台账，修一项划一项。
> 同批已落地：**§24 隐私脱敏**（trace 级 response_preview 默认 masked，`privacy:` 段 + glob 规则，
> coverage 落库前施加 —— Plan §47.3）与 Plan §47.1/§47.2 裁定回写。

## C 组 —— 2026-09-25 Plan × 实现对照新开（同日下午二批裁定：F1–F6 落地，详见 Plan §47.5/§47.6）

| # | 条目 | Plan 出处 | 状态 |
|---|---|---|---|
| C1 | 字段级响应值通道（valueType / valueState / hash 明细；现仅 trace 级 preview） | §24 | ☑ F1（client 代理就地产值特征 → field_hits 三列 → RequestDetail 透出；散列对完整值计算，C11 一并消解） |
| C2 | `coverage:` 条目 reason 字段（含报告/policySummary 透出） | §10/§16 | ☑ F2（条目升级 string \| {pattern, reason}；matched_rule_reason 落列；policySummary 附带 reason） |
| C3 | `replay:` 安全规则可配（现硬编码 GET-safe / POST-confirm） | §23 | ☑ F3（replay: 段 allowMethods/requireConfirmation/block；CLI 与 dashboard 同源；fail-closed） |
| C4 | CLI `report` / `replay` 子命令 | §5.1 | ☑ F4（report [--open]；replay request/scenario） |
| C5 | `config.resolved.json` 落盘（新增写盘面，需按铁律评审落点） | §10 | ☑ F5（per-run runs/{runId}/config.resolved.json，写者归 CLI，铁律不破） |
| C6 | `openapi.watch` / `app:`（CLI 代启用户应用）配置段 | §10/§39 | ☑ 裁定延期（Plan §47.6 归属确认，非缺口；随 watch 模式一并 SDD） |
| C7 | Agent：补 3 个内置插件（api-client/dsl/policy，§35.2-35.4）、权限四档、rollbackOnRegression 的回滚执行 | §35/§36/§38 | 部分裁定：权限四档/回滚 = §36/D1 自裁 MVP 后置（→ Plan §47.6，非缺口）；**3 个插件 ☑ 落地（2026-09-30，feat/c7-agent-plugins）**——api-client（add-api-call 任务，未调用 endpoint）、dsl（§35.3 确定性，无 provider，C9 解锁）、policy（suggest-policy 只建议）；AgentTask 升联合 + taskIdOf 稳定键 + api-client/policy 产 suggest-diff（provider.edit）；**runtime 循环仍只接 api-ui-agent，多 agent 接线 ☐ 待裁定**（循环状态机按 taskIdOf 已通用） |
| C8 | §33 用户级 `@mk/agent-sdk` 协议暴露 | §33 | ☑ 裁定+落地（2026-10-01，feat/c8-agent-sdk，§47.8.8）：`@mk/agent-sdk` 不建新包（D2）—— `@nx-mk/agent` 即 SDK 导出面（§33 类型 verbatim），类型别名裁定归档；**多 agent 接线落地**：`LoopDeps.agents: CoverageAgentPlugin[]`（plan 合并 backlog 保序，apply 按来源 agent 路由，plan 失败单 agent 容错跳过）；config `agent.agents: string[]` 白名单（CLI loop.ts 按 builtin 注册表构造，默认 `['api-ui-agent']` 行为不回归；未知名 CONFIG_INVALID）；基线 747/96/13（C8 全量回归实测） |
| C9 | Request DSL（`requests:` 段 + `dsl.generated.yml`）、Export DSL、Copy curl | §26.2/§22 | ☑ 核心 4 件全落地（2026-09-30，feat/c9-request-dsl；Copy curl 早于 F6 落）：① `request-dsl.ts` schema/`classifyFieldState`/`getFieldByPath` + ScenarioFile `requests:` 段向后兼容 + `loadRequests` 去重装载；② `verify-requests.ts` verifyRequests（method+pathname 匹配、status/fields 断言、no-body 记 partial 不 fail）；③ `generate-request-dsl.ts` traces 反推去重（≥400 跳过）→ run 产物 `dsl.generated.yml`（CLI warn-不阻断）+ report 路径透出；④ Export DSL（RequestDetail，纯子入口 `@nx-mk/scenario/request-dsl` 防 playwright-core 入浏览器 bundle）。新增 12 测试，基线 718/95/13 |
| C10 | Watch 模式 / TUI 实时进度（Plan 自标后置，低优） | §39 | ☑ 裁定延期（Plan §47.6 归属确认，非缺口） |
| C11 | 采集上限 500 字符 → 截断残片致结构化脱敏退化为正则兜底（与 C1 合并评估） | §24 | ☑ 随 F1 消解（字段级散列在浏览器内对完整值计算，不经截断） |

## C 组续批 —— 2026-09-29 全仓审计新开（编号顺延 C12–C16；Plan × master `a33d1a7` 逐节对照，裁定详情见 Plan §47.8）

| # | 条目 | Plan 出处 | 状态 |
|---|---|---|---|
| C12 | §30 设置面：`GET /api/settings` + `PATCH /api/settings/policy\|agent\|replay` 四路由与 `/settings/policy\|agent\|replay` 三页未建（现仅 `/settings/plugins` 插件写回可用） | §30 | ☑ 落地（2026-10-01，§47.8.7）：settings 路由（三段白名单 zod + preview/apply 两段式 sha 复核 + 段删除 null）与三页共用 SettingsSectionPage；基线 727/97/13 |
| C13 | `request_traces.replayable/replay_safety/replay_reason` 三列 flush 恒 NULL（F3/C3 只收 config + `classifyReplay()`，trace 级不落库，replay 时现算） | §23/§25.4 | ☑ 冻结裁定（2026-09-30，§47.8.5）：「replay 前现算不落库」为设计行为非缺数据——规则可变，落库会与现行规则漂移产生账实不一致；§25.4/client.ts 注记，三列留作未来只读展示扩展位 |
| C14 | §30 报告页缺口：`/runs/:runId/endpoints`（endpoint 覆盖页，数据在 metrics 路由与 DB 已备）与 `/runs/:runId/agent`（Agent Loop 页，`agent_iterations` 已落库）仅缺 UI | §30 | ☑ 落地（`/endpoints` 报告 endpoints 透出 + D12 门控；`/agent` 行列表 + 空态；RunOverview 双链接；路由/api-types/i18n/dashboard 测试 +8，基线 706/94/13） |
| C15 | coverage 模块缺 plan §8 的 `trace-store/field-extractor/value-masker/ui-evidence/metrics` 文件位——职能已被 db/client.ts（flushDrained）、client 代理、privacy/mask.ts、analyzer 内联吸收；`endpoints` 表有 `tags` 无 `summary`，`manifest_fields` 为精简裁定集（无 direction/status/description/schema_name） | §8/§25 | ☑ 文件布局裁定为 R3 同类（吸收合并，语义不缺）；DB 列集属 spec 裁定，仅注记不更名（`endpoints.summary` 若后续 Manifest Browser 需要，随 C14 一并评估） |
| C16 | `runtime/patch.ts`（patchGlobalFetch，SDK-CG3b fetch monkey-patch fallback）无命令接线：任何 CLI/dashboard 路径都不会启用它，仅 `migrate` 命令文案提示存在（plan 语义：未全量迁移时 coverage 不断） | §42.5 SDK-CG3 | ☑ 改道落地（见 fix 注记） |
| C17 | 插件中心真实安装：dashboard upload zip（解压到 .nx-mk/plugins/）与 npm 安装指令执行 —— 新运行时功能，带安全面（路径穿越防护、包校验、npm registry 依赖），UI 已置 disabled 占位（3-tab 重构安装区） | §30 | ☐ 待独立 SDD（安全面大；本轮 UI 只做展示+提示词引导） |

> 2026-09-29 审计同时确认：§47.1–47.7 全部逐项属实（R1–R8、F1–F6、G1–G5 在码复核通过）；
> C 组全清（C1–C16 ☑；C17 待独立 SDD）。测试基线 747 tests / 96 files / 13 包（C8 后实测）。
>
> **2026-10-01 UI 优化定版（dashboard 3-tab 重构）**：用户主导的界面重构 —— ① 视觉改版
> 纯白背景 + 极简 + 边框分割主义（无阴影/直角/语义色仅文字着色/代码块白底）；② 信息架构
> 收敛 3 大 tab：进度（#progress 五相时间线+报告卡片）、请求（#requests 统计条+列表，
> 自动取最新 run）、插件（#plugins 安装区占位+提示词模板+生命周期五组×钩点+已装列表）；
> 旧 14 页路由全保留（#overview/#runs/... 直达不回归）；**zip/npm 真实插件安装 = 新 backlog
> C17**（含安全面：路径穿越/npm registry/包校验，需独立 SDD）。测试 +6（three-tab.test.ts），
> 基线 733/97/13。

**C16 落地注记（2026-09-29，feat/c16-fetch-shim-fallback）**：
原 backlog 构想「`run`/`start` boot 时 patch globalThis.fetch」在审计中判**无效**——
coverage 采集通路在浏览器侧 `__MK_COLLECTOR__`，Node 侧 patch 看不到页面 fetch。
实际落法改道 browser：① `COLLECTOR_SHIM_SCRIPT` 建立 shim 时 patch `window.fetch`
（`/api` 前缀整段命中 → trace 进单通道，status 于响应 then 补齐；探针 try/catch 全吞；
幂等 `__MK_FETCH_PATCHED__`）；② 去重：client analysis 分支发原生 fetch 置
`__MK_SDK_INFLIGHT__`（finally 清除），shim 见标记跳过（该请求 trace 由 SDK 通路
全量上报），双重 trace 消除；③ `runtime/patch.ts`（Node 版 patchGlobalFetch）保留
为 SDK-CG3b 机制存量，接线裁为 browser 方案已承载该语义。测试 +5（fetch-shim.test.ts），
基线 700/92/13。

> **2026-09-25 插件 IO 对齐批注**（feat/plan-align-batch2）：CollectReport 改判别联合
> （method/path 恒在，'GET (unknown)' 伪影消解）；原 Ruling 8 落地（manifest normalizedPath
> 校验 + `__MK_MANIFEST__` 注入，endpointId 不再 'unknown'）；emitSignal 接线（done 声明
> → goal-loop `all-done` 早停）。已知残余：插件 `configSchema` 校验仅覆盖 config 声明路径
> （plugin-registry loadPlugins），CLI `extraPlugins` 代码装配不经此门 —— 属装配语义而非
> 缺口，随未来 per-plugin config 收敛一并评估。

---

> **2026-10-03 复核**：全仓逐条复核 + 全量回归实测。
> **基线刷新：812 tests / 104 files / 13 包全绿**（typecheck 15 目标零报错）—— 文中 747/96/13
> 为 C8 时点数据，C12–C16 与风格模板落地后已增长。
> **C 组状态收敛：C1–C16 全 ☑，C17 是唯一 ☐**（插件中心真实安装，安全面需独立 SDD）。
> 同期落地的 **Agent 风格模板**（PR #45）不计入 C 组 —— 属 §35.2 内置插件面横向扩展，
> 落地记录见 Plan **§47.9**（含 5 项实现期裁定 R1–R5）。

