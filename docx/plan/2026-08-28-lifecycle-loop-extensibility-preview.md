# nx-mk 基础可扩展性预留方案（生命周期 + Loop）

> **配套方案（供审阅）** · 生成日期: 2026-08-28
> 前置: [`2026-08-28-foundation-modification-plan.md`](./2026-08-28-foundation-modification-plan.md)（M1-M5）
> 范围: 基础层需要预先埋入的可扩展性接口，使未来生命周期 / Loop 扩展不破坏现有 API

---

## 1. 目标

### 1.1 上一方案的边界

`foundation-modification-plan.md` 明确了：

> **非目标（明确不做）**
> - 不引入 watch / daemon 模式（Phase 2 再考虑）
> - 不引入 effect 系统（Phase 2 再考虑）
> - 不引入 profile / patch layer（Phase 3 再考虑）
> - 不引入运行时配置热更（Phase 3 再考虑）

### 1.2 本方案目标

**不立即实现生命周期 / Loop 扩展，但预先在 M1-M5 中埋入可扩展性接口**，使得：

- 未来引入 effect / profile / patch layer / watch / daemon 时，**不需要 breaking change**
- 现有插件在 Phase 2 之后继续工作
- 现有 config 文件继续有效

### 1.3 范围

| 在范围内 | 不在范围内 |
|----------|------------|
| M1-M5 中的可扩展性预留点 | effect 系统实现（Phase 2） |
| 类型设计上的"未来兼容" | profile / patch layer 实现（Phase 3） |
| 接口签名上的"未来兼容" | watch / daemon 实现（Phase 2） |
| 文档化的"扩展方向" | 运行时配置热更（Phase 3） |

---

## 2. 生命周期可扩展性预留

### 2.1 未来需要的能力

基于借鉴评估，需要在 Phase 2-3 引入：

| 能力 | Phase | 用途 |
|------|-------|------|
| Effect 系统 | 2 | 插件声明副作用（订阅、文件句柄），内核自动逆序回收 |
| Profile / Patch Layer | 3 | 多套插件组合（dev/prod/ci）+ 用户层热重载 |
| 运行时配置热更 | 3 | 长跑 daemon 监听文件变化时热更插件配置 |

### 2.2 M1-M5 必须埋入的接口

#### 预留点 1：钩子返回值允许 AsyncDisposable（M1）

**当前钩子签名**（`packages/kernel/src/plugin.ts:19`）：

```ts
export type HookHandler = (ctx: PluginContext) => Promise<void> | void
```

**问题**：未来 effect 系统需要钩子返回 disposer 用于清理。但当前签名是 `void`。

**M1 改造**（仅签名变化，行为不变）：

```ts
export type HookHandler = (ctx: PluginContext) => 
  | void 
  | Promise<void>
  | AsyncDisposable    // ← 新增可选
  | Promise<AsyncDisposable>
```

**对现有插件的影响**：零（返回 void 的插件不需要改）。
**对未来的价值**：effect 系统接入时直接用，无需改 Plugin 接口。

---

#### 预留点 2：PluginState 增加 UNLOADING / DISPOSED（M1）

**当前 M1 设计**：

```ts
type PluginState =
  | { kind: 'pending' }
  | { kind: 'loading' }
  | { kind: 'active' }
  | { kind: 'failed' }
  | { kind: 'unloading' }    // ← 预留
  | { kind: 'disposed' }     // ← 预留
```

**对当前的影响**：UNLOADING / DISPOSED 状态在 M1 期间不会进入（无 reload API），但状态机定义完整。

**对未来的价值**：Phase 3 引入 `api.reloadPlugin()` 时直接用，无需改状态机。

---

#### 预留点 3：PluginConfig 独立于 Plugin 实例（M3）

**当前问题**：插件配置直接挂在 plugin 对象上（`plugin.config`），无法在不重新构造实例的情况下更新。

**M3 改造**：

```ts
export interface Plugin {
  name: string
  version: string
  hooks: PluginHooks
  configSchema?: StandardSchemaV1<unknown, unknown>
  inject?: string[]
  provide?: string[]
  // 内部：与 plugin 实例分离的运行时配置
  // 未来 reloadPlugin(name, newConfig) 时只换这一层
}
```

**对当前的影响**：零（运行时配置由 `PluginContext.config` 提供，插件不需要直接访问 `plugin.config`）。

**对未来的价值**：Phase 3 引入配置热更时，插件实例保持不变，只换 config 层。

---

#### 预留点 4：PluginContext 注入式服务（M3）

**当前 PluginContext 是扁平字段**：

```ts
interface PluginContext {
  config: ResolvedConfig
  logger: Logger
  events: EventBus
  kernel: KernelAPI
  cwd: string
}
```

**M3 改造**（基于借鉴 A + G）：

```ts
interface PluginContext {
  // 核心固定字段（无需 inject）
  config: ResolvedConfig
  kernel: KernelAPI
  cwd: string
  
  // 显式 inject（按声明提供）
  logger: Logger     // 需 inject: ['logger']
  events: EventBus   // 需 inject: ['events']
  
  // Phase 2 之后新增服务无需改 ctx 类型
  // 通过 ctx.get('cache') / ctx.inject(...) 取
  [serviceName: string]: unknown
}
```

**对当前的影响**：现有插件声明 `inject: ['logger', 'events']` 即可；不声明的默认隐式可用。

**对未来的价值**：Phase 2 引入 effect 系统 / profile 系统时新增服务（`cache` / `metrics` / `profile-registry`）不需要改 PluginContext 形状。

---

#### 预留点 5：phase 常量扩展性（kernel.ts）

**当前**：

```ts
const PHASES = ['loadConfig', 'resolvePlugins', 'initPlugins', 'run', 'shutdown'] as const
```

**M1 改造**（仅为 Phase 类型增加索引签名）：

```ts
export type Phase = 
  | 'loadConfig' 
  | 'resolvePlugins' 
  | 'initPlugins' 
  | 'run' 
  | 'shutdown'

// 未来扩展点（Phase 2+）：
// | 'scan'         // watch 模式
// | 'reload'       // 插件热更
// | 'snapshot'     // profile 快照
```

**对当前的影响**：零（仅类型层扩展，运行时不引入新 phase）。

**对未来的价值**：Phase 2 引入 watch 模式时只需在 PHASES 数组追加，不需要改 `runPhase` switch（用 `assertNever` 强制处理）。

---

#### 预留点 6：KernelAPI 预留 reload / extend 接口

**当前 KernelAPI**（`packages/kernel/src/plugin.ts:40-46`）：

```ts
interface KernelAPI {
  run(): Promise<RunResult>
  shutdown(reason?: string): Promise<void>
  getState(): KernelState
  getRunId(): RunId
  getSubcommand(): 'run' | 'init' | 'doctor'
}
```

**M3 改造**（新增可选方法，返回 never 实现以保持类型稳定）：

```ts
interface KernelAPI {
  run(): Promise<RunResult>
  shutdown(reason?: string): Promise<void>
  getState(): KernelState
  getRunId(): RunId
  getSubcommand(): 'run' | 'init' | 'doctor'
  
  // Phase 2+ 预留接口（M3 期间实现为 throw）
  reloadPlugin?(name: PluginName, config: unknown): Promise<void>
  extendProfile?(profile: ProfileSpec): Promise<void>
  on?(event: KernelEvent['type'], handler: (e: KernelEvent) => void): () => void
}
```

**对当前的影响**：零（可选方法，不调用时不存在）。

**对未来的价值**：Phase 3 引入这些方法时无需改 KernelAPI 形状（可选方法签名锁定）。

---

### 2.3 Phase 2 生命周期里程碑预览

> 以下**不在本方案实施范围**，仅为方向参考。

| 里程碑 | 内容 | 依赖 |
|--------|------|------|
| **M6** | Effect 系统（`ctx.effect(execute, label)`） | M3 (inject) |
| **M7** | Profile 组合（profile = bundle list + patch layer） | M2 (schema) |
| **M8** | 运行时配置热更（`api.reloadPlugin(name, newConfig)`） | M3 (config 分层) |
| **M9** | 启动顺序：profiles → bundles → user patches → launcher | M7 |

---

## 3. Loop 可扩展性预留

### 3.1 未来需要的能力

| 能力 | Phase | 用途 |
|------|-------|------|
| RunPhase 判别联合 | 2 | watch 模式（idle / scanning / processing / reporting） |
| Inbox 输入队列 | 2 | watch 模式外部触发入队 |
| 预编译 dispatcher | 2 | 高频事件零分配 |
| AbortController 支持 | 2 | watch / daemon 模式取消 |

### 3.2 M1-M5 必须埋入的接口

#### 预留点 7：事件总线支持 AbortSignal（M1）

**当前 `EventBus.emit` 不接收 AbortSignal**：

```ts
emit(event: KernelEvent): void
```

**M1 改造**（仅签名扩展）：

```ts
emit(event: KernelEvent, options?: { signal?: AbortSignal }): void
```

**对当前的影响**：零（options 可选）。

**对未来的价值**：Phase 2 watch 模式时，长跑监听可通过 AbortSignal 取消 emit / 处理。

---

#### 预留点 8：高频事件预编译 dispatcher（M5 文档化，M2 实现）

**当前**：`events.emit({ type: 'phase:start', ... })` 每次走 `emitter.emit('phase:start', event)` 字符串分发。

**M5 仅文档化**，M2 实现：

```ts
// M5 仅在 README 中标注：
// 未来优化：高频事件（phase:start/end, plugin:loaded, log）将走预编译 dispatcher
// 内部 API：events.typed<K>('phase:start')(payload) 直接调用，无字符串分发
```

**对当前的影响**：零（仅文档化）。

**对未来的价值**：Phase 2 实现 watch 模式时（每分钟 emit 数十次），预编译 dispatcher 是必要的优化路径。

---

#### 预留点 9：KernelState.currentPhase 改为判别联合（M1）

**当前**：

```ts
currentPhase: Phase | null
```

**M1 改造**：

```ts
// Phase 仍为字符串联合（不变），但 KernelState 增加结构化 phaseContext
currentPhase: Phase | null
phaseContext?: PhaseContext  // ← 新增可选字段

type PhaseContext =
  | { phase: 'loadConfig'; configPath: string }
  | { phase: 'resolvePlugins'; loadedSoFar: number }
  | { phase: 'initPlugins'; pendingDeps: string[] }
  | { phase: 'run'; startedAt: string; turn?: number }     // ← turn 字段为 watch 模式预留
  | { phase: 'shutdown'; reason: string }
```

**对当前的影响**：零（phaseContext 可选）。

**对未来的价值**：Phase 2 引入 watch 模式时，`run.turn` 字段自然支持 turn 计数；`initPlugins.pendingDeps` 支持依赖等待可视化。

---

#### 预留点 10：run 钩子设计为潜在 loop（M3）

**当前 run 阶段**（`kernel.ts:165-168`）：

```ts
} else if (phase === 'run') {
  await runHooksForPhaseWithCapture(phase, 'before', plugins, buildCtx())
  await runHooksForPhaseWithCapture(phase, 'after', plugins, buildCtx())
}
```

**M3 改造**（钩子签名扩展，允许循环语义）：

```ts
} else if (phase === 'run') {
  // Phase 1：单次执行 beforeRun + afterRun
  // Phase 2+：watch 模式时此处改为循环 until abort
  const abortController = new AbortController()
  ctx.signal = abortController.signal  // 注入给插件
  await runHooksForPhaseWithCapture(phase, 'before', plugins, buildCtx())
  // Phase 2+ watch loop goes here
  await runHooksForPhaseWithCapture(phase, 'after', plugins, buildCtx())
}
```

**对当前的影响**：零（仅类型层增加 `ctx.signal?` 可选字段）。

**对未来的价值**：Phase 2 watch 模式时，内核可在 run 阶段自然转 loop 而无需改 `runPhase` 函数结构。

---

#### 预留点 11：PluginContext 支持 AbortSignal（M3）

**当前 PluginContext**：

```ts
interface PluginContext {
  config: ResolvedConfig
  logger: Logger
  events: EventBus
  kernel: KernelAPI
  cwd: string
}
```

**M3 改造**（仅新增可选字段）：

```ts
interface PluginContext {
  // ... 已有字段
  signal?: AbortSignal  // ← Phase 2+ watch/daemon 模式专用
}
```

**对当前的影响**：零（可选）。

**对未来的价值**：Phase 2 watch 模式下，监听 openapi 文件变化的插件可订阅 `signal.addEventListener('abort', cleanup)`，实现优雅退出。

---

#### 预留点 12：KernelEvent 增加 turn / inbox 事件（M1 类型预留）

**当前 KernelEvent**：

```ts
| { type: 'phase:start'; phase: Phase; timestamp: string }
| { type: 'phase:end'; phase: Phase; durationMs: number; ... }
| { type: 'plugin:loaded'; ... }
| { type: 'plugin:error'; ... }
| { type: 'plugin:state-change'; ... }
| { type: 'kernel:error'; ... }
| { type: 'log'; ... }
```

**M1 改造**（类型注释标注未来事件）：

```ts
| { type: 'log'; ... }

// Phase 2+ watch 模式预留事件（类型注释）：
// | { type: 'turn:start'; turn: number; timestamp: string }
// | { type: 'turn:end'; turn: number; reason: ... }
// | { type: 'inbox:enqueue'; message: InboxMessage }
// | { type: 'inbox:claim'; message: InboxMessage; turn: number }
```

**对当前的影响**：零（注释，不影响代码）。

**对未来的价值**：Phase 2 引入 watch 模式时，事件类型已经预留位置。

---

### 3.3 Phase 2 Loop 里程碑预览

> 以下**不在本方案实施范围**，仅为方向参考。

| 里程碑 | 内容 | 依赖 |
|--------|------|------|
| **M10** | RunPhase 判别联合扩展（idle / scanning / processing / reporting） | M1 |
| **M11** | Inbox 输入队列（`ctx.inbox.enqueue()`） | M3 (signal) |
| **M12** | 预编译 dispatcher 实现 | M5 (文档化) |
| **M13** | watch 模式 CLI 子命令（`npx mk watch`） | M10 + M11 + M12 |

---

## 4. 完整扩展路线图

```
Phase 0 末期：M1-M5（本方案 + 基础修改方案）
  ↓
Phase 1：plugin-swagger 实战 + 多 Provider 验证（M4 拆分）
  ↓
Phase 2：生命周期扩展（M6-M9）+ Loop 扩展（M10-M13）
  ├─ M6 Effect 系统
  ├─ M7 Profile 组合
  ├─ M8 配置热更
  ├─ M9 启动顺序（profiles → bundles → patches）
  ├─ M10 RunPhase 判别联合
  ├─ M11 Inbox 输入队列
  ├─ M12 预编译 dispatcher
  └─ M13 watch 模式 CLI
  ↓
Phase 3：daemon 模式 + 远程触发 + 集群部署（未来）
```

---

## 5. M1-M5 中需要落地的预留点清单

汇总本方案中提到的所有预留点，对应 M1-M5 实施位置：

| 预留点 | 落地于 | 工作量（叠加在 M1-M5 上） |
|--------|--------|---------------------------|
| 1. HookHandler 返回值允许 AsyncDisposable | M1 | 0.5 天 |
| 2. PluginState 增加 UNLOADING / DISPOSED | M1 | 已包含 |
| 3. PluginConfig 独立于 Plugin 实例 | M3 | 已包含 |
| 4. PluginContext 注入式服务 | M3 | 已包含 |
| 5. Phase 常量扩展性（注释） | M1 | 0.5 天 |
| 6. KernelAPI 预留 reload / extend | M3 | 0.5 天 |
| 7. EventBus.emit 支持 AbortSignal | M1 | 0.5 天 |
| 8. 预编译 dispatcher 文档化 | M5 | 0.5 天 |
| 9. KernelState.phaseContext 判别联合 | M1 | 1 天 |
| 10. run 钩子设计为潜在 loop | M3 | 0.5 天 |
| 11. PluginContext.signal 可选字段 | M3 | 0.5 天 |
| 12. KernelEvent 注释未来事件 | M1 | 0.5 天 |

**预留点总工作量：5-6 天**（叠加在 M1-M5 上）

**M1-M5 原本估算：18-27 天**（详见基础修改方案）

**含预留后的总估算：23-33 天**

---

## 6. 风险评估

### 6.1 过度设计的风险

**问题**：M1-M5 期间埋入过多预留接口，导致 API 表面变大、文档复杂、测试覆盖成本上升。

**缓解策略**：

- 仅做"类型层预留"（可选字段、可选方法），不实现 runtime 逻辑
- 预留点必须有明确触发条件（"Phase 2+ 引入 X 时使用"），不接受纯猜测
- 每个预留点单独评估：是否真的需要？还是等 Phase 2 重新设计？

### 6.2 类型不稳定风险

**问题**：预留的可选方法 / 字段在 Phase 2 落地时签名可能不匹配。

**缓解策略**：

- 预留接口签名参考 dsh 的成熟模式（见借鉴评估 §3.4）
- 在 JSDoc 中明确标注"Phase 2+ 签名可能调整"
- 预留方法 M3 期间实现为 `throw new Error('not implemented yet')`，方便后续实现

### 6.3 文档同步风险

**问题**：预留接口若文档化不充分，开发者可能误用。

**缓解策略**：

- 每个预留字段 / 方法必须有 JSDoc `@experimental` 标签
- README 中明确标注"以下接口为 Phase 2+ 预留，请勿使用"
- 预留点文档与代码同步 review

---

## 7. 决策点

需要审阅人确认：

1. **预留点覆盖范围**：本方案提出的 12 个预留点是否都接受？还是仅采纳部分？
2. **预留策略**：仅类型层预留（推荐）还是允许部分 runtime 占位？
3. **触发条件**：每个预留点必须有明确的 Phase 2+ 用途描述，是否接受？
4. **工作量调整**：含预留后的 23-33 天是否可接受？
5. **与基础方案的关系**：本方案是附加在 M1-M5 上，还是重新评估 M1-M5 的范围？

---

## 8. 审阅签收

待审阅人确认 §7 决策点后，进入实施阶段。建议流程：

1. 决策点确认 → 锁定预留范围
2. 在基础修改方案的每个 M 中标注预留点的实施位置
3. 每个 M 完成时检查预留接口是否到位
4. Phase 1 实战后 review 预留接口是否真的被用到
5. Phase 2 开始前决定哪些预留点转为实现

---

## 附录 A：预留点与借鉴评估的对应

| 预留点 | 对应借鉴点（dsh-borrow-review） |
|--------|--------------------------------|
| 1 HookHandler AsyncDisposable | §3 借鉴 D（Effect 次级副作用） |
| 2 PluginState UNLOADING/DISPOSED | §3 借鉴 C（插件状态机） |
| 3 PluginConfig 独立 | §4 借鉴 H（配置热更） |
| 4 PluginContext 注入式 | §2 借鉴 A（注入式服务） |
| 5 Phase 常量扩展 | §3 借鉴 E（profile 组合） |
| 6 KernelAPI 预留 | §3+§4 借鉴 D+H（effect + 配置热更） |
| 7 EventBus AbortSignal | §5 借鉴 I（watch 模式） |
| 8 预编译 dispatcher | §5 借鉴 K（性能优化） |
| 9 KernelState.phaseContext | §5 借鉴 I（RunPhase 判别联合） |
| 10 run 钩子潜在 loop | §5 借鉴 I+J（watch + Inbox） |
| 11 PluginContext.signal | §5 借鉴 I（watch 模式） |
| 12 KernelEvent 注释未来事件 | §5 借鉴 J（Inbox 输入队列） |

---

## 附录 B：参考文件

### 当前 nx-mk 关键文件

- `packages/kernel/src/types.ts` — Phase / RunId / KernelState
- `packages/kernel/src/plugin.ts` — Plugin / PluginContext / KernelAPI / HookHandler
- `packages/kernel/src/event-bus.ts` — EventBus.emit / KernelEvent
- `packages/kernel/src/kernel.ts` — runPhase switch / 5 阶段驱动器

### 上一方案

- [`2026-08-28-foundation-modification-plan.md`](./2026-08-28-foundation-modification-plan.md) — M1-M5 详细定义

### 借鉴评估

- [`2026-08-28-dsh-borrow-review.md`](./2026-08-28-dsh-borrow-review.md) — dsh 模式借鉴依据

---

**扩展性预留方案结束** · 等待审阅
