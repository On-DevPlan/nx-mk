# Pipeline 架构

plan 对应：`docx/plan/nx-mk-plan.md` §12 总体架构 + §13 Pipeline 流程 + §14 微内核设计。

## 主干（plan 裁决）

- Pipeline 为单向阶段流：解析 manifest → 注入/启动采集 → 驱动 turn loop → 采集判定 → 报告落盘 → goal 终止（§13 顺序为准）
- 微内核 = kernel 只管生命周期与事件，业务能力全部经 plugin 挂入（§14 裁决：kernel 不直接 import coverage/client）
- lifecycle 钩子点见 `packages/kernel/src/hooks.ts` —— 新增钩子必须先在 plan §14.3 对应条目登记设计

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 装配入口 | packages/kernel/src/kernel.ts |
| 运行时驱动 | packages/kernel/src/kernel-runtime.ts |
| 钩子契约 | packages/kernel/src/hooks.ts |
| 插件注册 | packages/kernel/src/plugin-registry.ts |
| 插件状态注入 | packages/kernel/src/plugin-inject（测试 packages/kernel/src/__tests__/plugin-inject.test.ts） |

## 易错

- 新增阶段不改 §13 节点顺序——在对应钩子上扩展，不改主干
- plugin-registry 校验（plugin-schema.test.ts）先行失败是预期，先补 schema 再补实现
