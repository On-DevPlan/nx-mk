# SQLite schema 与审计

plan 对应：§25 SQLite 数据库设计（coverage.db 三表 + runs 审计）。

## 主干

- 库文件 `.nx-mk/coverage.db`，schema 在 db/schema.ts；db/client.ts 是连接门面
- 验收三查询（README Phase 3）：
  - `SELECT terminated_by FROM runs ORDER BY started_at DESC LIMIT 1`（期望 goal-met）
  - events.jsonl grep `"type":"goal:met"`
  - coverage-report.json `.metrics.requiredCoverage === 1`
- id-space 全部对齐 normalizedPath（§17 裁决）——库内 id 与 manifest id 冲突时以 normalizedPath 为准

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 表结构 | packages/coverage/src/db/schema.ts |
| 连接/写入 | packages/coverage/src/db/client.ts |
| 报告落盘 |packages/coverage/src/analyzer/report.ts |

## 易错

- 落库 Schema 演进是持久层破坏——加列必须带默认值可回填，journal 事件照旧可重放
- claim 在 [[nx-mk-dashboard]] 的 server/store/queries.ts 有对应读路径，动表必须同步
