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

## C 组 —— 2026-09-25 Plan × 实现对照新开

| # | 条目 | Plan 出处 | 状态 |
|---|---|---|---|
| C1 | 字段级响应值通道（valueType / valueState / hash 明细；现仅 trace 级 preview） | §24 | ☐ |
| C2 | `coverage:` 条目 reason 字段（含报告/policySummary 透出） | §10/§16 | ☐ |
| C3 | `replay:` 安全规则可配（现硬编码 GET-safe / POST-confirm） | §23 | ☐ |
| C4 | CLI `report` / `replay` 子命令 | §5.1 | ☐ |
| C5 | `config.resolved.json` 落盘（新增写盘面，需按铁律评审落点） | §10 | ☐ |
| C6 | `openapi.watch` / `app:`（CLI 代启用户应用）配置段 | §10/§39 | ☐ |
| C7 | Agent：补 3 个内置插件（dsl/auth/perf）、权限四档、rollbackOnRegression 的回滚执行 | §35/§36/§38 | ☐ |
| C8 | §33 用户级 `@mk/agent-sdk` 协议暴露 | §33 | ☐ |
| C9 | Request DSL（`requests:` 段 + `dsl.generated.yml`）、Export DSL、Copy curl | §26.2/§22 | ☐ |
| C10 | Watch 模式 / TUI 实时进度（Plan 自标后置，低优） | §39 | ☐ |
| C11 | 采集上限 500 字符 → 截断残片致结构化脱敏退化为正则兜底（与 C1 合并评估） | §24 | ☐ |
