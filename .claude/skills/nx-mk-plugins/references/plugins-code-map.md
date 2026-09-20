# plugins 代码地图

插件契约与实现落点。

| 行为 | 文件 |
| --- | --- |
| 插件契约（hooks/schema/registry） | packages/kernel/src/{hooks,plugin,plugin-registry,plugins-manifest}.ts |
| 契约测试 | packages/kernel/src/__tests__/plugin-{schema,assembly,registry,inject,state}.test.ts |
| playwright 注册 + Ruling 8 | packages/plugin-playwright/src/index.ts |
| chromium 采集驱动 | packages/plugin-playwright/src/runner.ts |
| UI 证据扫描 | packages/plugin-playwright/src/scanner.ts |
| swagger 插件全量 | packages/plugin-swagger/src/index.ts |

新插件四步（固定顺序）：kernel 契约实现 → plugins-manifest 登记 → plugin-schema 测试扩面 → dashboard plugins-reader 侧验证 per-run manifest 可读。
