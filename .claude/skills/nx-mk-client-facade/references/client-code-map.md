# client-facade 代码地图

| 行为 | 文件 |
| --- | --- |
| SDK 生成 | packages/client/src/codegen/（generate-sdk / emit-endpoint / emit-types） |
| SDK 方法追踪 | packages/client/src/proxy/create-tracked-proxy.ts |
| 归一化 | packages/client/src/proxy/path-normalizer.ts |
| 运行时客户端 | packages/client/src/runtime/client.ts |
| fetch 兜底 | packages/client/src/runtime/patch.ts |
| 采集缓冲 | packages/client/src/collector/collector.ts、noop-collector.ts |
| analysis 开关 | packages/client/src/mode/analysis.ts |
| UI evidence 标记 | packages/client/src/react/Field.tsx |
| 静态迁移 | packages/client/src/migrate/engine.ts |
| 包门面 | packages/client/src/index.ts |

测试分布：packages/client 各子模块就近（codegen 校验依赖 demo:codegen 集成而非单测）。
