# kernel 代码地图

按「要动什么行为」反查文件。plan 章节标注在括号内。

| 行为 | 文件 | plan |
| --- | --- | --- |
| 装配/启动 | kernel.ts | §14 |
| Pipeline 驱动 | kernel-runtime.ts | §13 |
| 生命周期钩子 | hooks.ts | §14.3 |
| 事件总线 | event-bus.ts | §15 |
| goal 判定 | goal-loop.ts | §26/§28 |
| 初始 coverage 预填 | initial-coverage.ts | §28 |
| 插件注册/校验 | plugin-registry.ts、plugin.ts | §14 |
| 插件清单（per-run manifest） | plugins-manifest.ts | §31 |
| 统一错误 | errors.ts | §14 |
| 日志 | logger.ts | §15 |
| 类型/RunState | types.ts | §15 |

测试全景：packages/kernel/src/__tests__/（15 个测试文件，goal-loop-integration 与 plugin-assembly 是改动必跑）。
