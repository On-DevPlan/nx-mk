# RunState 与事件总线

plan 对应：§15 RunState 与实时进度（含事件 schema 与消费端约定）。

## 主干

- RunState 单例状态机，字段演进是 API 破坏——新增字段必须可缺省（旧 events.jsonl 重放不炸）
- event-bus 单发布通道，事件类型 union 定义于 kernel `types.ts`；dashboard poller（packages/dashboard/src/ui/poller.ts）与 server event-tail（packages/dashboard/src/server/event-tail.ts）按同一 union 消费
- runs.terminated_by 枚举：`goal-met` / `manual` / `fail-fast`，禁止私扩——先改 plan §15

## 代码落点

| 行为 | 文件 |
| --- | --- |
| 事件 union 定义 | packages/kernel/src/types.ts |
| 总线实现 | packages/kernel/src/event-bus.ts |
| 断言穷尽 | packages/kernel/src/__tests__/assert-never.test.ts |

## 易错

- dashboard 只有轮询通道（R11 裁决：保留 polling，SSE/WS 后置）——不要给 kernel 事件加推送假设
- 事件字段命名 monkey patch 在 packages/agent/src/patches.ts 有对齐逻辑，动事件名需同步 grep patches
