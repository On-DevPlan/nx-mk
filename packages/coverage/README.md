# `@nx-mk/coverage`

> 覆盖率存储与分析 —— SQLite 落盘 + 三指标 analyzer + policy engine + anti-cheat

## 概述

本包是 nx-mk 的「采集落盘 + 覆盖率分析」层，四块职责：

| 模块 | 入口 | 职责 |
|---|---|---|
| 存储 | `openCoverageDb` / `CoverageDb` | `.nx-mk/coverage.db` 建表 + trace / evidence / hit 批量 flush |
| 分析 | `analyzeCoverage` | 由 traces + hits + evidence 算出字段级覆盖率与三指标，产出 `CoverageReport` |
| 策略 | `evaluatePolicy` / `matchGlob` | manifest 字段 × policy 配置 → required / optional / ignored 判定 |
| 反作弊 | `classifyEvidence` | UI evidence 质量分级（hidden DOM suspicious / 空标记 weak） |

另有 `scanDom` —— 在浏览器页面上下文扫描 `[data-mk-field]` 标记，产出字段描述符。

## 数据库表（9 张）

`.nx-mk/coverage.db` 的表清单由 `TABLE_NAMES` 导出，DDL 由 `SCHEMA_SQL` 导出：

| 表 | 内容 |
|---|---|
| `runs` | 每次 run 的元信息（含 `terminated_by` 终止原因审计） |
| `endpoints` | manifest 的 endpoint 维度 |
| `manifest_fields` | manifest 的字段全量（覆盖率分母来源） |
| `request_traces` | 请求级 trace（含 Phase 2 起预留的 `scenario_id` / `dsl_step_id` 两列） |
| `request_fields` | 响应中实际返回的字段 |
| `field_hits` | 前端代码中「读取字段值」的运行时证据 |
| `ui_evidence` | UI 层可见性标记证据 + 质量分级 |
| `coverage_fields` | 分析产出的字段级四态结果（批量落库、单事务） |
| `agent_iterations` | Agent Loop 每轮迭代记录 |

## 指标与状态

`CoverageReport.metrics`（`CoverageReportMetrics`）含：`requiredCoverage`、`effectiveCoverage`、
`rawBackendFieldCoverage`，以及 `endpointsTotal/Called`、`fieldsTotal/Returned`、`requiredFields`、
`missingRequiredFields`、`ignoredReturnedFields`、`suspiciousFields` 等计数。

字段级结果 `FieldCoverageItem`：

- `state`（§21.3 四态）：`covered` | `missing` | `ignored` | `notApplicable`
- `policyStatus`：`required` | `optional` | `ignored` | `unknown`
- 另含 `hitCount` 与 `matchedRule`（命中的 policy 规则来源与 glob 模式）

## 用法

```ts
import { openCoverageDb, analyzeCoverage, evaluatePolicy } from '@nx-mk/coverage'

const db = openCoverageDb('.nx-mk/coverage.db')
db.flush({ runId, hits, traces, evidence })   // 批量落库（内部事务化）

const policyDecisions = evaluatePolicy({ manifest, config: policyConfig })
const report = analyzeCoverage({ runId, manifest, policyDecisions, drained, db })
console.log(report.metrics.requiredCoverage)
```

`FlushInput` = `{ runId, hits, traces, evidence }`；
`AnalyzeInput` = `{ runId, manifest, policyDecisions, drained, db }`。

`CoverageDb.transaction?(fn)` 为可选能力：提供时 `coverage_fields` 批量写入走单事务，
无此能力的替身（测试用）逐条 fallback，行为不变。

## 测试

```bash
pnpm test
```

## 设计参考

- 方案 §25（SQLite 数据库设计）、§28（Coverage Analyzer）、§21（Coverage Policy）、§29（Evidence Quality 与反作弊）
- 采集侧配套包：`@nx-mk/client`（collector / proxy）、`@nx-mk/plugin-playwright`（DOM 扫描）
