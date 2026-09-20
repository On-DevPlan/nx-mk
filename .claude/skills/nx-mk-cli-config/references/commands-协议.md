# CLI 命令协议

plan 对应：§9 CLI 命令设计（命令面与 flag 语义唯一真相）。

## 主干

- 命名：`npx nx-mk <command>`，命令面以 §9 表为准——不引入未登记命令
- `run` fail-fast（spec §4）：vite/后端未起先报错退出，不许静默等待
- `run` 驱动 Goal Loop 后验收三点互证（stdout 三行 / events.jsonl goal:met / ANALYSIS db terminated_by）——见 [[nx-mk-coverage-analysis]] [[sqlite-schema]] 验收查询
- `loop` 编排多轮：未达成 → 重启动 run，允许 2-3 轮校准回路后人工介入

## 代码落点

| 行为 | 文件 |
| --- | --- |
| run 驱动 + fail-fast | packages/cli/src/commands/run.ts |
| goal 编排 | packages/cli/src/commands/loop.ts |
| dashboard 启动 | packages/cli/src/commands/start.ts |
| 静态迁移 | packages/cli/src/commands/migrate.ts |
| 脚手架/诊断 | packages/cli/src/commands/{init,doctor}.ts |
| 门面 | packages/cli/src/index.ts |

## 易错

- `MK_ANALYSIS=true` 给 vite 进程不是 CLI（define 烘焙语义）——CLI 文档不许写反
- events.jsonl 落盘消费在 cli 侧（kernel 只发布），动事件读写先看 run.ts
