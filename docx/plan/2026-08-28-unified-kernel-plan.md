# nx-mk 微内核 / 插件系统 / 生命周期 完整方案

> **总方案（Master Plan，供审阅）** · 生成日期: 2026-08-28
> 范围: nx-mk 基础层的完整演进路径
> 前置文档（详细设计已就绪，本方案整合要点）：
> - [`2026-08-28-dsh-borrow-review.md`](./2026-08-28-dsh-borrow-review.md) — dsh 借鉴评估
> - [`2026-08-28-foundation-modification-plan.md`](./2026-08-28-foundation-modification-plan.md) — M1-M5 基础稳定性
> - [`2026-08-28-lifecycle-loop-extensibility-preview.md`](./2026-08-28-lifecycle-loop-extensibility-preview.md) — 可扩展性预留
> - [`2026-08-28-goal-oriented-loop-design.md`](./2026-08-28-goal-oriented-loop-design.md) — M14 Goal Loop
> - M15 Registry + Selectors（本文档新增）

---

## 0. 阅读对象与目的

本文是 nx-mk 基础层（M1-M5 + M14-M17）的**统一总方案**，回答：

1. **整体愿景**：nx-mk 的内核 + 插件 + 生命周期最终长什么样？
2. **路径设计**：从当前 Phase 0 演进到完整基础的里程碑顺序
3. **核心抽象**：Plugin / Kernel / Registry / Goal Loop 四者的关系
4. **决策点**：哪些决定需要审阅人拍板

**核心结论**：

- 模式 = **Registry + Subscriber Selection + Goal-Oriented Multi-Turn Orchestrator**
- = Nacos 思想（注册中心 + 订阅者主动选择）+ dsh ReactLoopAgent 思想（多轮 + 终止条件）
- in-process 实现，但保留分布式扩展点
- 总工程量：**~3000 行 runtime 代码 + ~2000 行测试 = ~5000 行**

---

## 1. 整体愿景

### 1.1 三大模式融合

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   ┌──────────────────────┐                                     │
│   │ Registry 模式        │ ← Nacos 思想：发布者注册元数据     │
│   │ (M15)                │   订阅者按 selector 过滤           │
│   └──────────┬───────────┘                                     │
│              │                                                 │
│              ▼                                                 │
│   ┌──────────────────────┐                                     │
│   │ Coordinator-Worker   │ ← dsh 思想：插件自治             │
│   │ (M14 Goal Loop)      │   协调者聚合 + 状态机             │
│   └──────────┬───────────┘                                     │
│              │                                                 │
│              ▼                                                 │
│   ┌──────────────────────┐                                     │
│   │ Goal-Oriented        │ ← 终止 = 目标达成                │
│   │ Termination          │   不是"都 done"                    │
│   └──────────────────────┘                                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 核心抽象

| 抽象 | 来源 | 职责 |
|------|------|------|
| **Plugin** | M1-M5 | 单元：name/version/hooks/inject/provide/meta |
| **Kernel** | M1-M5 | 生命周期：5 阶段驱动 + state machine + 事件总线 |
| **Registry** | M15 | 发现：plugin 注册元数据 + selector 过滤 + watch |
| **Goal Loop** | M14 | 协调：多轮 turn + 覆盖率计算 + 目标终止 |

### 1.3 完整数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│                          nx-mk Kernel                                │
│                                                                      │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌─────────� │
│   │ loadConfig │ →  │resolvePlugs│ →  │initPlugins │ →  │   run   │ │
│   │   phase    │    │   phase    │    │   phase    │    │  phase  │ │
│   └────────────┘    └────────────┘    └────────────┘    └────┬────┘ │
│                                                              │      │
│                                                              ▼      │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │                    Goal-Oriented Loop (M14)                  │  │
│   │                                                              │  │
│   │   while (not terminated):                                    │  │
│   │     1. turn:start                                            │  │
│   │     2. plugins process turn (emitReport / emitSignal)        │  │
│   │     3. drain pending                                         │  │
│   │     4. compute coverage[N]                                   │  │
│   │     5. progress check (idle detection)                       │  │
│   │     6. check termination:                                    │  │
│   │        - signal.aborted                                      │  │
│   │        - ratio >= target                                     │  │
│   │        - maxTurns / idleLimit / absoluteTimeout               │  │
│   │        - allFailed                                           │  │
│   │     7. notifyWatchers (M15)                                  │  │
│   │     8. turn:end                                              │  │
│   │                                                              │  │
│   │   Plugins discovered via Registry (M15):                     │  │
│   │     selector = byCapability('sdk-interceptor')               │  │
│   │             AND byCapability('browser-evidence')             │  │
│   │             AND byPriority()                                 │  │
│   │                                                              │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                  ┌──────────────────────────┐
                  │     GoalResult           │
                  │  kind: met | unmet | aborted │
                  │  coverage: Coverage       │
                  │  turns: number            │
                  │  reports: PluginReport[]  │
                  └──────────────────────────┘
```

---

## 2. 阶段路线图

### 2.1 完整里程碑图

```
Phase 0 末期 ────► Phase 1 ────► Phase 2 ────► Phase 3
   │                  │             │             │
   ▼                  ▼             ▼             ▼

[M1] 状态机       [M4] 拆分       [M6] Effect    [M9] 启动顺序
[M2] Schema       [M5] 类型强化   [M7] Profile   [M10] 热更
[M3] Inject                       [M8] Config
                                   热更
                                   │
                                   ▼
                                  [M14] Goal Loop ← 本方案核心
                                   │
                                   ▼
                                  [M15] Registry + Selectors
                                   │
                                   ▼
                                  [M16] Sample Plugin
                                   │
                                   ▼
                                  [M17] Watch + Goal Loop 集成
```

### 2.2 依赖关系

```
M1 → M2 → M3 ─────────────┐
   │   │   │              │
   │   │   │              ▼
   │   │   └────► M5 ──► M14 ──► M15 ──► M16 ──► M17
   │   │                    │       │
   │   └────► M4 ───────────┘       │
   │                                │
M3 ─────────────────────────────────┘
```

| 里程碑 | 依赖 | 工作量 | 累计 |
|--------|------|--------|------|
| M1 状态机 | - | 3-5 天 | 3-5 |
| M2 Schema | M1 | 5-7 天 | 8-12 |
| M3 Inject | M2 | 5-7 天 | 13-19 |
| M4 Manifest 拆分 | M3 | 3-5 天 | 16-24 |
| M5 类型强化 | (任何阶段) | 2-3 天 | 18-27 |
| M14 Goal Loop | M1-M5 | 5-7 天 | 23-34 |
| M15 Registry | M14 | 4-5 天 | 27-39 |
| M16 Sample Plugin | M15 | 3-4 天 | 30-43 |
| M17 Watch 集成 | M16 | 2-3 天 | 32-46 |

**总估算：6-9 周（含 review + 测试 + 文档）**

---

## 3. 核心抽象详细规格

### 3.1 Plugin（M1-M3 落地）

```ts
// packages/kernel/src/plugin.ts

export interface Plugin {
  /** 唯一显示名（package.json name） */
  name: string
  
  /** 版本（package.json version） */
  version: string
  
  /** 钩子集（beforeRun / afterRun / ...） */
  hooks: PluginHooks
  
  /** 可选：配置 schema（standard-schema） */
  configSchema?: StandardSchemaV1<unknown, unknown>
  
  /** 可选：依赖的服务 */
  inject?: string[]
  
  /** 可选：对外提供的服务 */
  provide?: string[]
  
  /** 可选：插件元数据 */
  meta?: Partial<PluginMeta>
}

export interface PluginContext {
  config: ResolvedConfig
  logger: Logger
  events: EventBus
  kernel: KernelAPI
  cwd: string
  signal?: AbortSignal
  
  /** M15：Registry 访问 */
  registry: Registry
  
  /** M14：报告产出 */
  emitReport(report: PluginReport): void
  emitSignal(signal: PluginSignal): void
  getTurn(): number
  getCoverage(): Coverage
}
```

### 3.2 Kernel（M1-M5 落地）

```ts
// packages/kernel/src/kernel.ts

export interface KernelAPI {
  run(): Promise<RunResult>
  shutdown(reason?: string): Promise<void>
  getState(): KernelState
  getRunId(): RunId
  getSubcommand(): 'run' | 'init' | 'doctor'
}

export interface KernelState {
  runId: RunId
  currentPhase: Phase | null
  phaseContext?: PhaseContext
  startedAt: string
  loadedPlugins: string[]
  pluginStates: Map<PluginName, PluginWorkerState>  // ← M1
  collectionResult?: GoalResult                       // ← M14
  error?: { code: string; message: string }
}

// 5 阶段顺序驱动器（保持不变）
const PHASES = ['loadConfig', 'resolvePlugins', 'initPlugins', 'run', 'shutdown'] as const
```

### 3.3 Registry（M15 落地）

```ts
// packages/kernel/src/registry.ts

export interface Registry {
  register(meta: PluginMeta): void
  deregister(instanceId: string): void
  discover(): PluginMeta[]
  discoverWith(selector: PluginSelector): PluginMeta[]
  watch(selector: PluginSelector, callback: (current: PluginMeta[]) => void): () => void
  heartbeat(instanceId: string): void
  updateHealth(instanceId: string, health: PluginMeta['health']): void
}

export interface PluginMeta {
  instanceId: string
  serviceName: 'plugin'
  name: string
  version: string
  capabilities: string[]
  provide: string[]
  inject: string[]
  priority: number
  health: 'healthy' | 'idle' | 'failed' | 'done'
  lastHeartbeatAt: string
}

export interface PluginSelector {
  matches(meta: PluginMeta): boolean
  describe(): string
}

// 预置 Selector
export const Selectors = {
  byCapability(cap: string): PluginSelector
  byProvide(service: string): PluginSelector
  byPriority(): PluginSelector
  and(...selectors: PluginSelector[]): PluginSelector
}
```

### 3.4 Goal Loop（M14 落地）

```ts
// packages/kernel/src/goal-loop.ts

export interface GoalConfig {
  targetRatio: number           // 默认 1.0
  maxTurns: number              // 默认 100
  idleTurnsLimit: number        // 默认 3
  absoluteTimeoutMs: number     // 默认 600000
}

export interface Coverage {
  total: number
  covered: number
  ratio: number
  missing: MissingItem[]
}

export interface GoalResult {
  kind: 'met' | 'unmet' | 'aborted'
  coverage: Coverage
  turns: number
  durationMs: number
  reports: PluginReport[]
  pluginStates: Map<PluginName, PluginWorkerState>
  terminatedBy: 'goal-met' | 'max-turns' | 'idle' | 'timeout' | 'aborted' | 'all-failed'
}

export async function runGoalLoop(opts: {
  plugins: Plugin[]
  goal: GoalConfig
  initialCoverage: Coverage
  ctx: PluginContext
  signal: AbortSignal
  registry: Registry
}): Promise<GoalResult>
```

---

## 4. 里程碑详细规格

### M1：插件状态机 + 可观测性

**目标**：每个插件状态对外可见，错误恢复路径清晰。

**核心改动**：

```ts
// 新增 PluginState（M1）
type PluginWorkerState =
  | { kind: 'active'; reportsEmitted: number; lastActivityAt: string }
  | { kind: 'done'; reason: string; finalReportCount: number; finishedAt: string }
  | { kind: 'failed'; error: { code: string; message: string }; failedAt: string }

// 新增事件
| { type: 'plugin:state-change'; name: string; from: PluginState['kind']; to: PluginState['kind']; timestamp: string }
```

**文件改动**：`types.ts` / `event-bus.ts` / `plugin-registry.ts` / `kernel.ts` / 测试。

**验收**：现有 6 个测试通过 + 新增状态转换测试。

---

### M2：Standard-Schema 校验

**目标**：插件配置错误早失败、错误消息友好。

**核心改动**：

```ts
// 新增 @mk/schema 包
export function validateConfig<T>(
  schema: StandardSchemaV1<unknown, T>,
  rawConfig: unknown,
): T

// Plugin 接口
configSchema?: StandardSchemaV1<unknown, unknown>

// KernelError 新增
| { code: 'PLUGIN_CONFIG_INVALID', ... }
```

**样板插件**：`plugin-swagger` 声明第一个 `configSchema`。

---

### M3：声明式 inject

**目标**：依赖关系显式化，重构安全。

**核心改动**：

```ts
// Plugin 接口
inject?: string[]
provide?: string[]

// kernel.ts initPlugins 阶段真正有意义：等待所有依赖满足
```

**依赖满足性检查**：

```ts
async function resolveDependencies(plugins: Plugin[]): Promise<void> {
  const provided = new Set<string>()
  for (const p of plugins) if (p.provide) for (const n of p.provide) provided.add(n)
  for (const p of plugins) {
    const missing = (p.inject ?? []).filter(n => !provided.has(n))
    if (missing.length > 0) throw new KernelError('PLUGIN_DEPENDENCY_MISSING', ...)
  }
}
```

---

### M4：Manifest 拆分

**目标**：多 OpenAPI 来源支持。

**拆分边界**：

```
manifest-schema (Definition)     ← types / field-id / schema-walker / normalizer
    ↑
manifest-openapi (Provider)      ← parser + plugin 入口
```

**未来扩展**：

```
manifest-postman (Provider)      ← Phase 2+
manifest-graphql (Provider)      ← Phase 2+
```

---

### M5：类型强化

**目标**：类型即契约。

**核心改动**：

```ts
declare const __brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [__brand]: B }

export type RunId = Brand<string, 'RunId'>
export type PluginName = Brand<string, 'PluginName'>
export type PhaseName = Brand<Phase, 'PhaseName'>

export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}
```

---

### M14：Goal-Oriented Loop

**目标**：多轮 + 覆盖率目标终止。

**核心改动**：

- `Coverage` / `GoalConfig` / `GoalResult` 类型
- `PluginReport` / `PluginSignal` 类型
- `runGoalLoop` 函数
- `turn:start` / `turn:end` / `goal:met` / `goal:unmet` 事件
- `PluginContext.emitReport` / `emitSignal` / `getTurn` / `getCoverage`

**终止决策表**：

| 优先级 | 条件 | 结果 |
|--------|------|------|
| 1 | signal.aborted | aborted |
| 2 | ratio >= targetRatio | met |
| 3 | turnN >= maxTurns | unmet: max-turns |
| 4 | idleTurns >= idleTurnsLimit | unmet: idle |
| 5 | absoluteTimeoutMs | unmet: timeout |
| 6 | allActiveFailed | unmet: all-failed |

**详细设计**：见 [`2026-08-28-goal-oriented-loop-design.md`](./2026-08-28-goal-oriented-loop-design.md)

---

### M15：Registry + Selectors

**目标**：注册中心抽象 + 订阅者主动选择。

**核心改动**：

```ts
// Registry 接口
interface Registry {
  register(meta: PluginMeta): void
  deregister(instanceId: string): void
  discover(): PluginMeta[]
  discoverWith(selector: PluginSelector): PluginMeta[]
  watch(selector: PluginSelector, callback: (current: PluginMeta[]) => void): () => void
  heartbeat(instanceId: string): void
  updateHealth(instanceId: string, health: PluginMeta['health']): void
}

// InProcessRegistry 实现
class InProcessRegistry implements Registry { ... }

// Selectors
const Selectors = {
  byCapability, byProvide, byPriority, and
}
```

**Plugin Meta 字段**：

```ts
interface PluginMeta {
  instanceId: string
  serviceName: 'plugin'
  name: string
  version: string
  capabilities: string[]
  provide: string[]
  inject: string[]
  priority: number
  health: 'healthy' | 'idle' | 'failed' | 'done'
  lastHeartbeatAt: string
}
```

**PluginRegistry 加载时自动注册**：

```ts
const meta: PluginMeta = { ... }
opts.registry.register(meta)
```

**未来扩展**：把 `InProcessRegistry` 替换为 `NacosRegistry` / `EtcdRegistry`，支持分布式。

---

### M16：Sample Plugin

**目标**：用真实多源场景验证 M14 + M15。

**第一个样板插件**：`plugin-sdk-interceptor`

```ts
export const configSchema = z.object({
  minSamples: z.number().int().positive().default(10),
})

export default createPlugin({
  inject: ['events', 'registry'],
  provide: ['coverage-report'],
  meta: {
    capabilities: ['sdk-interceptor'],
    priority: 50,
  },
}, (ctx) => {
  let collected = 0
  ctx.events.on('sdk/request', (req) => {
    ctx.emitReport({ kind: 'endpoint-called', method: req.method, path: req.path, turn: ctx.getTurn() })
    collected++
  })
  return { name: 'plugin-sdk-interceptor', version: '0.1.0', hooks: { ... } }
})
```

**验证场景**：

- 启动 SDK interceptor → 上报 5 endpoints → 覆盖率 40%
- 启动 browser evidence → 上报 3 routes → 覆盖率 55%
- 启动 CI data → 上报 12 historical → 覆盖率 100% → goal:met

---

### M17：Watch + Goal Loop 集成

**目标**：Registry watch 变化时自动通知 Goal Loop。

**核心改动**：

```ts
// goal-loop.ts
const stopWatch = opts.registry.watch(
  Selectors.byProvide('coverage-report'),
  (currentMetas) => {
    events.emit({
      type: 'plugins:changed',
      timestamp: new Date().toISOString(),
      active: currentMetas.length,
    })
  }
)
```

**事件流**：

```
新插件加载 → registry.register() → notifyWatchers() → plugins:changed
                                                  ↓
                                          Goal Loop 可订阅此事件
```

---

## 5. 配置集成

```yaml
# nx-mk.config.yml
plugins:
  - plugin-swagger
  - plugin-sdk-interceptor
  - plugin-browser-evidence
  - plugin-coverage-advisor

# M14
goal:
  targetRatio: 1.0
  maxTurns: 100
  idleTurnsLimit: 3
  absoluteTimeoutMs: 600000

# M15
registry:
  type: in-process       # 未来: nacos / etcd
  heartbeatIntervalMs: 5000
  heartbeatTimeoutMs: 15000
```

---

## 6. 复杂度总览

| 里程碑 | Runtime | 测试 | 文档 | 累计 |
|--------|---------|------|------|------|
| M1 | 80 | 100 | 30 | 210 |
| M2 | 150 | 200 | 50 | 400 |
| M3 | 120 | 180 | 40 | 340 |
| M4 | 100 | 150 | 30 | 280 |
| M5 | 60 | 80 | 20 | 160 |
| M14 | 460 | 350 | 80 | 890 |
| M15 | 250 | 200 | 50 | 500 |
| M16 | 200 | 150 | 40 | 390 |
| M17 | 100 | 80 | 20 | 200 |
| **总计** | **1520** | **1490** | **360** | **3370** |

**runtime 代码占比 45%，测试占比 44%，文档占比 11%**。

---

## 7. 风险登记

| 风险 | 等级 | 缓解 |
|------|------|------|
| 多轮循环死锁 | 高 | 三层 bounds（maxTurns / idleTurns / absoluteTimeout）+ signal abort |
| 假数据循环 | 中 | progress check 基于 ratio 而非 report 数 |
| Coverage 计算遗漏类型 | 中 | computeCoverage 强制 assertNever 处理所有变体 |
| 测试覆盖不足 | 中 | 三类场景：happy / stuck / aborted 各 5+ 测试 |
| Registry 替换为分布式后语义差异 | 低 | Registry 接口稳定，InProcessRegistry 是参考实现 |
| Goal Loop 实现偏差 dsh 复杂度 | 低 | 严格按 M14 设计，不引入 Inbox / turn step |

---

## 8. 与已有方案的关系

本方案**整合**而非替换：

| 已存在方案 | 整合方式 |
|------------|----------|
| dsh-borrow-review | 提供模式依据（借鉴点 → 里程碑映射） |
| foundation-modification-plan | 完整纳入 M1-M5 |
| lifecycle-loop-extensibility-preview | 可扩展性预留点已分配到 M1-M5 |
| goal-oriented-loop-design | 完整纳入 M14 |

**所有详细设计文档继续保留**，本文档提供统一视图 + 决策整合。

---

## 9. Phase 路线图

```
Phase 0 末期（立即开始）:  M1 → M2 → M3 → M4 → M5
  目标：基础稳定性、向后兼容、不破坏现有 API
  
Phase 1（基础就绪后）:    实施 plugin-swagger 配置 schema + 实战验证 M4 拆分
  
Phase 2（多轮化）:        M14 → M15 → M16 → M17
  目标：多源异步采集 + 覆盖率目标终止
  
Phase 3（未来）:          M6 → M7 → M8 → M9（Effect / Profile / 热更）
  目标：长跑 daemon + 插件热管理
```

---

## 10. 决策点（需审阅人确认）

### 10.1 整体接受度

- [ ] 接受"Registry + Goal Loop"双模式融合作为 nx-mk 基础？
- [ ] 接受 6-9 周的工程量？
- [ ] 接受 ~3370 行的总代码量（含测试 + 文档）？

### 10.2 里程碑顺序

- [ ] M1 → M2 → M3 → M4 → M5 → M14 → M15 → M16 → M17 顺序合理？
- [ ] 是否需要并行某些 M（如 M5 与 M3 同时）？

### 10.3 Goal Loop 核心场景

- [ ] nx-mk 核心场景是 CI 集成 + 多源汇聚（需要 Goal Loop）？
- [ ] 还是单次分析 + watch（不需要 Goal Loop，只需 Collection Loop）？

### 10.4 Registry 实现选型

- [ ] InProcessRegistry 即可（推荐）？
- [ ] 还是直接做 NacosRegistry（未来分布式需求已明确）？

### 10.5 Selector 表达力

- [ ] 接受 `byCapability` / `byProvide` / `byPriority` / `and` 四个预置？
- [ ] 是否需要 `or` / `not` / `versionRange`？

### 10.6 Heartbeat 必要性

- [ ] in-process 场景需要 heartbeat？
- [ ] 还是仅依赖 state machine？

### 10.7 Sample Plugin 选型

- [ ] 第一个样板插件是 `plugin-sdk-interceptor`（推荐）？
- [ ] 还是 `plugin-browser-evidence` / `plugin-ci-data`？

### 10.8 与已有方案关系

- [ ] 本方案作为 master plan 保留？
- [ ] 旧的四份详细方案保留作为附录？
- [ ] 还是合并到本方案、删除旧的？

---

## 11. 审阅签收

待审阅人确认 §10 决策点后，进入实施阶段。建议流程：

1. 决策点确认 → 锁定本方案
2. 旧方案保留作为附录 + 本方案作为 master reference
3. M1 开始实施
4. 每个 M 完成时 review：是否需要调整后续 M
5. M5 完成时 review：是否真的需要 M14 Goal Loop
6. M14 完成时 review：M15 Registry 是否真的必要
7. M17 完成时进入 Phase 3 评估

---

## 附录 A：里程碑详细参考

| 里程碑 | 详细设计文档 |
|--------|--------------|
| M1-M5 | [`2026-08-28-foundation-modification-plan.md`](./2026-08-28-foundation-modification-plan.md) |
| M14 | [`2026-08-28-goal-oriented-loop-design.md`](./2026-08-28-goal-oriented-loop-design.md) |
| M15-M17 | 本文档（§4 详细规格） |
| 可扩展性预留 | [`2026-08-28-lifecycle-loop-extensibility-preview.md`](./2026-08-28-lifecycle-loop-extensibility-preview.md) |
| 借鉴依据 | [`2026-08-28-dsh-borrow-review.md`](./2026-08-28-dsh-borrow-review.md) |

---

## 附录 B：nx-mk 当前架构快照

### 包结构

```
packages/
├── kernel/          # @mk/kernel — 微内核（8 文件）
├── config/          # @mk/config — 配置 schema + loader
├── manifest/        # @mk/manifest — OpenAPI → Manifest
├── cli/             # @mk/cli — npx mk 入口
└── plugin-swagger/  # @mk/plugin-swagger — OpenAPI 适配
```

### 当前内核文件

- `kernel/src/types.ts` — Phase / RunId / KernelState / PHASES
- `kernel/src/errors.ts` — KernelError + mapErrorCodeToExit
- `kernel/src/plugin.ts` — Plugin / PluginContext / KernelAPI
- `kernel/src/plugin-registry.ts` — 动态 import + factory + 三段校验
- `kernel/src/hooks.ts` — 钩子执行器（fail-fast 串行）
- `kernel/src/event-bus.ts` — 6 类事件 + JSONL 持久化
- `kernel/src/logger.ts` — 内核 NDJSON logger
- `kernel/src/kernel.ts` — 5 阶段驱动器

### 当前生命周期

```
loadConfig → resolvePlugins → initPlugins → run → shutdown
```

每个阶段前后触发 `before{Phase}` / `after{Phase}` 钩子，fail-fast。

---

## 附录 C：dsh 借鉴映射表

| 借鉴点（dsh-borrow-review） | nx-mk 里程碑 |
|---------------------------|--------------|
| §2 借鉴 A（注入式服务） | M3 + M15 |
| §2 借鉴 B（Capability Seam） | M4 |
| §3 借鉴 C（插件状态机） | M1 |
| §3 借鉴 D（Effect 系统） | Phase 3（M6） |
| §3 借鉴 E（Profile 组合） | Phase 3（M7） |
| §4 借鉴 F（Standard-Schema） | M2 |
| §4 借鉴 G（声明式 inject） | M3 |
| §4 借鉴 H（配置热更） | Phase 3（M8） |
| §5 借鉴 I（RunPhase 判别联合） | M14 |
| §5 借鉴 J（Inbox 输入队列） | M14（简化：不引入 inbox） |
| §5 借鉴 K（预编译 dispatcher） | 不做（性能优化阶段） |

---

**完整方案结束** · 等待审阅
