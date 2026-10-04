# config schema

plan 对应：§10 配置文件设计（含 demo 实配校准注记：coverage.ignored 实配 7 条是校准产物，spec §3.6 示例仅示意）。

## 主干

- config 三入口段：`goal:`（goal-loop 消费）+ `coverage:`（policy-engine 消费）+ `dashboard:`；agent 段见 [[nx-mk-cli-config]]
- loader.ts 负责发现路径（demo 目录内运行）+ fail-fast：未起 vite/后端先报错（spec §4）
- schema.ts 是唯一校验真相；agent-schema.test.ts / dashboard-schema.test.ts 分段对齐

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 发现与加载 | packages/config/src/loader.ts |
| 校验 schema | packages/config/src/schema.ts |
| 段对应测试 | packages/config/src/__tests__/loader.test.ts |

## 易错

- demo 的 config 与 examples/react-vite-demo/nx-mk.config.yml 单真相——不要在 plan 里引入第二个示例来源
- CI 段（E1/E2）MVP 已删（plan §10 注），不要复活
