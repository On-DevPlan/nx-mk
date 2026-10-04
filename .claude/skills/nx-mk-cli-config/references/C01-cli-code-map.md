# cli 代码地图

| 行为 | 文件 |
| --- | --- |
| run 命令（fail-fast + goal 驱动 + events 落盘消费） | packages/cli/src/commands/run.ts |
| goal loop 编排 | packages/cli/src/commands/loop.ts |
| start（dashboard 一键） | packages/cli/src/commands/start.ts |
| migrate（委托 client engine） | packages/cli/src/commands/migrate.ts |
| init / doctor | packages/cli/src/commands/{init,doctor}.ts |
| 门面 | packages/cli/src/index.ts |
