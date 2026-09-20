---
name: nx-mk-coverage-analysis
description: Use when working on packages/coverage —— policy-engine、coverage analyzer 三指标四态、anti-cheat、SQLite 落库、ignored 口径校准. Progressive disclosure with refs to plan sections and code map.
---

# nx-mk coverage-analysis

coverage policy → 反作弊 → analyzer 三指标 → SQLite 落库 → coverage-report。主干导航，口径与库表细节在 references/。

## 板块边界

`packages/coverage/src/` 五个子模块：policy / anti-cheat / analyzer / evidence / db。不含采集来源（见 [[nx-mk-client-facade]]），不含 goal 消费（见 [[nx-mk-kernel-core]]）。

## 判定主干（勿改顺序）

1. `policy/policy-engine.ts` + `policy/glob.ts`：coverage.ignored 规则（`*`/`**`/字面，§21 优先级）
2. `evidence/dom-scanner.ts` + `anti-cheat/classify.ts`：hidden DOM suspicious / 空标记 weak（anti-cheat v0，§29）
3. `analyzer/coverage-analyzer.ts`：三指标 + 四态 → `report.ts` 产出 coverage-report.json
4. `db/`：field_hits / ui_evidence / request_traces 三表 + runs.terminated_by 审计（§25 SQLite）

## 口径裁决

- 三指标：required / effective / raw backend coverage（§28 完整口径）
- 四态：covered / missing / ignored / suspicious（§21.3）
- ignored 口径校准回路：goal 不达成且字段真实低覆盖时改 config `coverage.ignored`，2-3 轮收敛——不改代码，只改配置

## 引用索引（按需加载）

| ref | 何时读取 | 路径 |
| --- | --- | --- |
| [[policy-口径]] | 动 ignored/glob 规则、优先级、四态判定前 | references/policy-口径.md |
| [[sqlite-schema]] | 动库表、悝 ASC 查询、审计字段前 | references/sqlite-schema.md |
| [[coverage-code-map]] | 在 coverage 内定位行为落点 | references/coverage-code-map.md |

## 校验

`corepack pnpm --filter @nx-mk/coverage build`；改口径必须重跑 `pnpm demo:codegen` 全量看三指标（README §Phase 3 期望值）。
