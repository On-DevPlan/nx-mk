# goal-loop 协议

plan 对应：§26 DSL 设计（goal 段）+ §28 Coverage Analyzer 三指标 + CLI run 驱动（§13.4）。

## 主干

- goal 判定每 turn 执行：读 coverage-report 三指标（requiredCoverage / effective / raw backend）比对 config `goal:` 段 → 达成即发 `goal:met` 事件、`runs.terminated_by='goal-met'`
- 三指标准确口径以 §28 为准；goal 只消费已落库指标，不重复计算
- 未达成 → 继续下一 turn；连续失败/超时终止路径在 runtime.ts（agent 包）与 cli loop.ts 均有对应映射，改协议需三处同步

## 代码落点

| 行为 | 文件 |
| --- | --- |
| goal 判定实现 | packages/kernel/src/goal-loop.ts |
| 三指标集成测试 | packages/kernel/src/__tests__/goal-loop-integration.test.ts |
| CLI 驱动侧 | packages/cli/src/commands/run.ts、loop.ts |
| 覆盖指标产出 | packages/coverage/src/analyzer/coverage-analyzer.ts |

## 易错

- goal 段配置 schema 在 packages/config/src/schema.ts（goal: + coverage: 两段），判定消费的字段要与 schema 对齐
- demo 校准回路：goal 不达成优先查 demo manifest 与 coverage.ignored（见 [[nx-mk-coverage-analysis]]），不要先动 kernel
