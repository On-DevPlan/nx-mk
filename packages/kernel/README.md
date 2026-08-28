# `@nx-mk/kernel`

> nx-mk 微内核 —— 插件 + 事件 + 生命周期

## 概述

本包提供 nx-mk 的核心微内核：

- **5 阶段生命周期**：`loadConfig → resolvePlugins → initPlugins → run → shutdown`
- **插件合约**：`Plugin` / `PluginContext` / `PluginHooks`
- **事件总线**：类型化事件 + JSONL 持久化
- **错误系统**：稳定错误码 + 进程退出码映射

## 插件状态机（M1）

每个插件在生命周期内的状态由 `PluginWorkerState` 表示：

```ts
import type { PluginWorkerState, PluginName } from '@nx-mk/kernel'

type PluginWorkerState =
  | { kind: 'active'; activatedAt: string }
  | { kind: 'done'; reason: string; finishedAt: string }
  | { kind: 'failed'; error: { code: string; message: string }; failedAt: string }
  // 预留（M2+ 启用）
  | { kind: 'pending'; waitedFor: string[] }
  | { kind: 'loading' }
  | { kind: 'unloading' }
  | { kind: 'disposed' }
```

### 当前启用的状态（M1）

| 状态 | 进入时机 | 进入原因 |
|------|----------|----------|
| `active` | `resolvePlugins` 阶段加载成功 | 插件可用并参与后续阶段 |
| `done` | M2+ 启用 | 插件主动声明完成 |
| `failed` | 钩子抛错被 `KernelError(PLUGIN_HOOK_FAILED)` 包装 | 加载或执行失败 |

### 查询状态

```ts
const kernel = createKernel({ ... })
await kernel.run()

const state = kernel.getState()
// state.pluginStates 是 Map<PluginName, PluginWorkerState>
for (const [name, s] of state.pluginStates) {
  console.log(`${name}: ${s.kind}`)
}
```

## 事件订阅（M1）

事件总线新增 `plugin:state-change` 事件。订阅示例：

```ts
const kernel = createKernel({ ... })
// 通过 events.jsonl（事后分析）或 ctx.events 订阅（M1 仅支持前者）
```

事件格式（写入 `events.jsonl`）：

```json
{
  "type": "plugin:state-change",
  "name": "@nx-mk/sdk-interceptor",
  "from": "pending",
  "to": "active",
  "timestamp": "2026-08-28T15:00:00.000Z"
}
```

```json
{
  "type": "plugin:state-change",
  "name": "@nx-mk/thrower",
  "from": "active",
  "to": "failed",
  "timestamp": "2026-08-28T15:00:01.234Z",
  "error": { "code": "PLUGIN_HOOK_FAILED", "message": "hook-boom" }
}
```

## 向后兼容

M1 不破坏现有 API：

- `loadedPlugins: string[]` 仍保留（旧字段不删除）
- `pluginStates: Map<PluginName, PluginWorkerState>` 为新增字段
- `KernelState.getState()` 返回浅拷贝（新 Map）

## 测试

```bash
pnpm test
```

覆盖：

- 6 个原有测试文件
- `plugin-state.test.ts`（M1 新增，4 个测试）
  - 加载成功时 `pluginStates` 反映状态
  - `plugin:state-change` 事件被正确发出
  - 钩子失败时状态转为 `failed`
  - `loadedPlugins` 字段仍可用（向后兼容）

## 设计参考

详细设计见 [`docx/plan/2026-08-28-foundation-modification-plan.md`](../../docx/plan/2026-08-28-foundation-modification-plan.md) M1 章节。
