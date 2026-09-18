# nx-mk 卫生 Backlog（hygiene backlog）

> 创建：2026-09-18（Phase 5 收尾后重建）
> 来源：Phase 3 终审 13 项（PR #9 描述压缩版）+ Phase 4 终审 13 项（PR #10 描述压缩版）+ 2026-09-18 对当前 master 逐项核实
> 状态图例：☐ 待修 / ☑ 已修（修完即划）
> 说明：本文件是这些非阻塞发现的**唯一持久记录**（各期 SDD 台账随验收清理删除）。修一项划一项。

---

## A 组 —— 2026-09-18 核实仍存在

| # | 条目 | 位置 | 核实依据 |
|---|---|---|---|
| A1 | `kernel.ts` 超 400 行纪律（500 行，Phase 3 时 498） | `packages/kernel/src/kernel.ts` | `wc -l` = 500 |
| A2 | `plugin-swagger` typecheck 失败 ×2：测试 fixture 落后 kernel 类型（缺 `pluginStates`、缺 `PluginContext` 的 emitReport/emitSignal/getTurn/getCoverage/getMissing） | `packages/plugin-swagger/src/__tests__/index.test.ts:38,42` | `tsc --noEmit` exit 2，两处 TS2741/TS2739 |
| A3 | `Poller.start()` 不幂等：重复调用泄漏 interval | `packages/dashboard/src/ui/poller.ts:26` | 无 timer 判空 |
| A4 | `Poller.refresh` 成功路径无 aborted 卫语句：被取代的旧响应仍可 `onUpdate` | `poller.ts:47` | 仅 catch 分支有卫语句 |
| A5 | static 竞态 500：`existsSync` 与 `readFile` 之间文件消失 → 应 404 | `packages/dashboard/src/server/static.ts:49-52` | TOCTOU 窗口 |
| A6 | MIME 扩展表不全，未知扩展一律 `application/octet-stream` | `static.ts:12` | 仅 3 项 |
| A7 | 根 `esbuild ^0.27.0` override 卡死 demo app vite 构建（Phase 4 时 stash 证明非本期引入；dashboard 包自身以 `build.target: 'es2022'` 绕开） | 根 `package.json` | Phase 4 终审记录 |

## B 组 —— 终审记录在案、位置已知、本次未逐一复核

| # | 条目 | 位置 | 出处 |
|---|---|---|---|
| B1 | `coverage_fields` 与 field_hits/ui_evidence 三表写非原子（失败 run 部分落库） | `packages/coverage/src/analyzer/coverage-analyzer.ts:75` | Phase 3 终审 M3 |
| B2 | analyzer `unknown` 分支零测试（生产可达：decision 缺失时 `status='unknown'`） | `coverage-analyzer.ts:85` | Phase 3 终审 T7 |
| B3 | analyzer `startsWith` 弱判别（noise-guard 独立断言兜底） | analyzer | Phase 3 终审 T9 |
| B4 | `METHOD_NAME_BLOCKLIST` own-property 语义（原型链方法误判） | `packages/client/src/proxy/create-tracked-proxy.ts:38` | Phase 3 终审 |
| B5 | dashboard 测试 fixtures tmp 根泄漏 | dashboard tests | Phase 4 终审 |
| B6 | 非 404 错误页仍显 loading 态 | dashboard UI | Phase 4 终审 |
| B7 | `drainBrowserCollector` READ+CLEAR 非原子（多轮 turn 丢数据窗口） | client collector | Phase 3 终审 |
| B8 | collector/proxy index re-exports 卫生 | client 包 | Phase 3 终审 |

## 已修记录

（暂无）
