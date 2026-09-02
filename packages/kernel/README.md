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

## Goal Loop（M14）

`runGoalLoop` 提供多轮目标驱动的覆盖率采集循环：

```ts
import { runGoalLoop, computeCoverage } from '@nx-mk/kernel'

const result = await runGoalLoop({
  plugins,
  goal: { targetRatio: 1.0, maxTurns: 100, idleTurnsLimit: 3, absoluteTimeoutMs: 600_000 },
  initialCoverage: { total: 20, covered: 0, ratio: 0, missing: [...] },
  ctx,
  signal: abortController.signal,
})

// result.kind: 'met' | 'unmet' | 'aborted'
// result.coverage: { total, covered, ratio, missing }
// result.turns: number
// result.terminatedBy: 'goal-met' | 'max-turns' | 'idle' | 'timeout' | 'aborted' | 'all-failed'
```

### 插件 API（M14）

```ts
export default createPlugin((ctx) => ({
  name: '@nx-mk/my-plugin',
  version: '1.0.0',
  hooks: {
    afterRun(ctx) {
      // 在 Goal Loop 中上报数据
      ctx.emitReport({ kind: 'endpoint-called', method: 'GET', path: '/users', turn: ctx.getTurn() })
      ctx.emitSignal({ kind: 'done', reason: 'all-collected', turn: ctx.getTurn() })
    },
  },
}))
```

### 终止决策（按优先级）

1. `signal.aborted` → `aborted`
2. `coverage.ratio >= targetRatio` → `met`
3. `turn >= maxTurns` → `unmet: max-turns`
4. `idleTurns >= idleTurnsLimit` → `unmet: idle`
5. `now - start >= absoluteTimeoutMs` → `unmet: timeout`
6. 所有 active 插件 failed → `unmet: all-failed`

### 当前状态（M14 first delivery）

`goal-loop.ts` 模块已实现并通过独立测试。**kernel.run() 的完整 Goal Loop 集成留作后续工作**（下一轮 PR）。

当前 PluginContext 的 emit/emitSignal/getTurn/getCoverage/getMissing 为 stub（返回空 / 默认值）。

详细设计见 [`docx/plan/2026-08-28-goal-oriented-loop-design.md`](../../docx/plan/2026-08-28-goal-oriented-loop-design.md)。

## 插件依赖声明（M3）

插件可声明 `inject?: string[]` 与 `provide?: string[]` 做显式依赖管理：

```ts
import type { Plugin } from '@nx-mk/kernel'

// 提供方：声明此插件对外暴露的能力
const providerPlugin: Plugin = {
  name: '@nx-mk/sdk-interceptor',
  version: '1.0.0',
  hooks: {},
  provide: ['request-store', 'coverage-report'],
}

// 消费方：声明依赖
const consumerPlugin: Plugin = {
  name: '@nx-mk/coverage-aggregator',
  version: '1.0.0',
  hooks: {},
  inject: ['request-store', 'coverage-report'],
}
```

### 核心服务（无需声明）

内核直接注入以下核心服务，不视为外部依赖：

- `logger` — 内核 logger
- `events` — 事件总线
- `kernel` — 内核句柄（`KernelAPI`）
- `config` — 解析后的配置
- `cwd` — 当前工作目录

### 校验时机

`initPlugins` 阶段会调用 `resolveDependencies()` 检查所有 inject 是否被 provide 满足。

未满足时抛 `KernelError(PLUGIN_DEPENDENCY_MISSING)`，退出码 7。

### 向后兼容

不声明 `inject` / `provide` 的旧插件继续工作（无依赖检查）。

## 插件配置校验（M2）

插件可声明 `configSchema?: StandardSchemaV1<unknown, unknown>` 做配置校验：

```ts
import { z } from 'zod'
import type { Plugin } from '@nx-mk/kernel'

export const configSchema = z.object({
  openapi: z.object({
    path: z.string().min(1),
    servers: z.array(z.object({ url: z.string().url() })).min(1),
  }),
})

const plugin: Plugin = {
  name: '@nx-mk/my-plugin',
  version: '1.0.0',
  hooks: {},
  configSchema,  // ← 声明后由 @nx-mk/schema 在加载时校验
}
```

校验失败抛 `KernelError(PLUGIN_CONFIG_INVALID)`，退出码 6。

支持的库：所有符合 `@standard-schema/spec` 的库（zod / valibot / arktype 等）。

未声明 `configSchema` 的旧插件继续工作（向后兼容）。

## 测试

```bash
pnpm test
```

覆盖：

- 6 个原有测试文件 + M1 新增 `plugin-state.test.ts`（4 测试）
- M2 新增 `plugin-schema.test.ts`（3 测试）
- M3 新增 `plugin-inject.test.ts`（6 测试）

## 设计参考

详细设计见：
- [`docx/plan/2026-08-28-foundation-modification-plan.md`](../../docx/plan/2026-08-28-foundation-modification-plan.md) M1-M2 章节
- 配套包：`@nx-mk/schema`（standard-schema 适配层）
