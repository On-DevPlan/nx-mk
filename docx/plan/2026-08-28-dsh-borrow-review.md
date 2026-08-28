# dsh (deepseek-harness) → nx-mk 借鉴价值评估

> **审阅文档** · 生成日期: 2026-08-28 · 范围: 微内核 / 生命周期 / 插件系统 / Loop 循环
> 参考实现: `D:\DevProjects\my\github\nx-mk\.claude\repo\deepseek-harness`（vendored Cordis 在 `vendor/cordis/`，核心 loop 在 `packages/core/agent-loop/`）

---

## 0. 阅读对象与目的

本文针对 nx-mk 当前 Phase 0 的微内核设计，回答以下问题：

1. dsh (基于 Cordis) 在微内核 / 生命周期 / 插件系统 / Loop 四个轴上有哪些成熟的工程模式？
2. 这些模式中，哪些对 nx-mk 的下一阶段有直接借鉴价值？
3. 借鉴的优先级与改动量如何评估？

> dsh 的代码规模（12,404 commits、250+ 包、40+ capability groups）与 nx-mk 当前（5 个包、8 个内核文件、Phase 0）差距巨大。本文**不主张全盘照搬**，而是筛选出"小改动、高价值"的可移植模式。

---

## 1. nx-mk 当前架构快照（基线）

### 1.1 包结构

```
packages/
├── kernel/          # @mk/kernel — 微内核（8 文件）
├── config/          # @mk/config — 配置 schema + loader
├── manifest/        # @mk/manifest — OpenAPI → Manifest
├── cli/             # @mk/cli — npx mk 入口（占位）
└── plugin-swagger/  # @mk/plugin-swagger — OpenAPI 适配插件
```

### 1.2 内核关键抽象（`packages/kernel/src/`）

| 文件 | 职责 |
|------|------|
| `types.ts` | `Phase`、`ResolvedConfig`、`KernelState`、`RunId`、`PHASES` 常量 |
| `errors.ts` | `KernelError` + `mapErrorCodeToExit`（错误码 → 退出码） |
| `plugin.ts` | `Plugin` / `PluginContext` / `PluginHooks` / `KernelAPI` 类型契约 |
| `plugin-registry.ts` | 动态 import + factory 解析 + 三段校验 |
| `hooks.ts` | 钩子执行器（fail-fast 串行 + 错误包装） |
| `event-bus.ts` | 6 类事件的 typed union + JSONL 持久化 |
| `logger.ts` | 内核 NDJSON logger |
| `kernel.ts` | `createKernel` 工厂 + 5 阶段驱动器 |

### 1.3 生命周期模型

固定 5 阶段顺序驱动器：

```
loadConfig → resolvePlugins → initPlugins → run → shutdown
```

每个阶段前后触发 `before{Phase}` / `after{Phase}` 钩子。`run` 阶段几乎空壳，由插件填充。

### 1.4 插件模型

```ts
interface Plugin {
  name: string
  version: string
  hooks: PluginHooks  // 可选键集：beforeRun / afterRun / ...
}
```

加载链路（`plugin-registry.ts:29-88`）：

1. 校验插件名匹配 `PLUGIN_NAME_RE`
2. 动态 `import(name)`
3. 解析 factory（`default` 或 `createPlugin`）
4. 调用 factory 得到 plugin 对象
5. `validateShape`（检查 name/version/hooks 类型）
6. `validatePackageMatch`（与 package.json 对照）

### 1.5 事件模型

6 类 `KernelEvent` 判别联合：

- `phase:start` / `phase:end`
- `plugin:loaded` / `plugin:error`
- `kernel:error`
- `log`

emit 时 JSONL 追加写 `events.jsonl`，订阅者通过 `events.on(type, handler)` 注册。

---

## 2. 微内核 (Microkernel)

### 2.1 dsh 的做法

**Context-as-Proxy**（`vendor/cordis/src/context.ts:42-80`）：

```ts
class Context {
  reflect = new ReflectService(self)   // service resolver
  registry = new RegistryService(self) // 插件注册表
  events = new EventsService(self)     // 事件总线
  logger = new LoggerService(self)     // 日志服务
}
```

读 `ctx.logger` 时实际走 `ReflectService` 解析对应服务实例。Context 形状不变，新增能力只新增 Service。

**Capability Seam**（dSH `CLAUDE.md` 关键词）：

> A capability seam comprises Service Definition / Service Provider / Consumer roles. It is complete, never one role; split only when roles evolve independently.

每个能力 = Definition（声明接口）+ Provider（具体实现）+ Consumer（消费方）三角色。

例：`packages/llm/` 是 Definition，`packages/llm/deepseek/` 是 Provider，Agent 是 Consumer。

### 2.2 nx-mk 当前差距

`PluginContext` 是固定字段：

```ts
interface PluginContext {
  config: ResolvedConfig
  logger: Logger
  events: EventBus
  kernel: KernelAPI
  cwd: string
}
```

新增能力（如未来的 cache、metrics）需要：
1. 改 `PluginContext` 类型
2. 在 `buildCtx()` 里加字段
3. 所有插件类型同步更新

`manifest` 包同时承担 OpenAPI 解析（Provider）与 schema 规范化（Definition），未拆三角色。

### 2.3 可借鉴模式

#### 借鉴 A：PluginContext → 注入式服务（中等改动量）

把 `logger` / `events` 从固定字段改为可注入服务。nx-mk 内部仍可保留当前字段名作为兼容层，但底层走 Reflect-style service resolver。

```ts
// 改造前（固定字段）
ctx.logger.info('...')

// 改造后（可选：声明式注入）
// plugin 声明 inject: ['logger', 'events']
ctx.logger.info('...')  // 内部走 resolver
```

**价值**：新增能力不需要改 ctx 形状。
**风险**：与 TypeScript 类型推导的兼容需要测试；不声明 inject 时字段仍可用（向后兼容）。

#### 借鉴 B：拆 manifest 为 Definition + Provider（小改动量）

把 `packages/manifest/` 拆成两个角色：

- `@mk/manifest-schema`（Definition）：`types.ts` / `field-id.ts` / `schema-walker.ts` / `normalizer.ts`
- `@mk/manifest-openapi`（Provider）：`parser.ts` + 插件入口

未来 `plugin-postman` / `plugin-graphql` 各自只实现 Provider，共享 Definition。

**价值**：多 OpenAPI 来源时直接受益，与 dsh 的 llm/deepseek 模式一致。
**风险**：需要同步更新 `plugin-swagger` 的依赖。

### 2.4 不建议直接借鉴的部分

- dsh 的 ReflectService（Proxy 实现）过于复杂，nx-mk 当前规模用不到。
- dsh 的 `@Inject()` 装饰器依赖 TC39 stage 3 装饰器，nx-mk 当前 TypeScript 配置可能不支持，需先评估。

---

## 3. 生命周期 (Lifecycle)

### 3.1 dsh 的做法

#### 3.1.1 Fiber 状态机（`vendor/cordis/src/fiber.ts:147-154`）

```ts
export const enum FiberState {
  PENDING,     // 等依赖
  LOADING,     // 插件回调正在跑
  ACTIVE,      // 已加载并提供中
  FAILED,      // 配置/启动失败
  UNLOADING,   // 正在清理
  DISPOSED,    // 已移除
}
```

每个状态迁移触发 `internal/status` 事件，外部可观察 fiber 状态变化。

#### 3.1.2 Effect 替代 Hook（`vendor/cordis/src/fiber.ts:415-561`）

```ts
effect(execute, label) // execute 返回 Disposable | Promise | Iterable | AsyncIterable
```

disposers 按逆注册顺序执行；子 effect 自动归属父 effect；async 用 `await fiber.await()` 等待。

#### 3.1.3 Profile + Patch Layer（`packages/boot/app-boot/src/profile.ts:24-100`）

profile = 有序的 bundle 包列表 + 用户 patch layer。启动顺序：

```
empty → bundle[0].patches → ... → bundle[n].patches → profile patches → launcher patches
```

支持 `patchReload: 'live' | 'startup'` 热重载用户层。

### 3.2 nx-mk 当前差距

`KernelState.currentPhase: Phase | null` 只追踪 5 个 phase 字符串，无法区分"加载中 / 已激活 / 失败"。

`loadedPlugins: string[]` 只记名字，没有状态。

钩子模型是固定 `before{Phase}` / `after{Phase}` + fail-fast 串行，缺灵活性。

插件通过 `nx-mk.config.yml` 的 `plugins: [...]` 单层加载，无 profile / patch 概念。

### 3.3 可借鉴模式

#### 借鉴 C：插件状态机（小改动量，高价值）

把 `loadedPlugins: string[]` 升级为 `pluginStates: Map<string, PluginState>`：

```ts
type PluginState =
  | { kind: 'pending'; waitedFor: string[] }
  | { kind: 'loading' }
  | { kind: 'active'; activatedAt: string }
  | { kind: 'failed'; error: { code: string; message: string } }
  | { kind: 'unloading' }
  | { kind: 'disposed' }
```

新增事件 `plugin:state-change: { name, from, to, timestamp }`。

**价值**：调试 / 错误恢复路径立刻清晰；外部工具可观察每个插件的实时状态。
**风险**：需要同步更新 `kernel.ts` 的状态跟踪逻辑与事件总线。

#### 借鉴 D：保留 phase 钩子 + 引入 effect 作为次级副作用（中等改动量）

保留当前 5 阶段钩子作为顶层生命周期；在插件内部允许 `ctx.effect(() => { return () => cleanup() })` 注册次级副作用（订阅事件、打开文件句柄等），内核在 shutdown 时自动逆序回收。

```ts
// 顶层 phase 钩子（保留）
hooks: { beforeRun, afterRun, beforeShutdown, afterShutdown }

// 次级 effect（新增）
ctx.effect(() => {
  const sub = ctx.events.on('log', handler)
  return () => sub()  // 自动逆序清理
}, 'my-plugin:log-sub')
```

**价值**：插件可以声明"我监听了什么资源"而不仅"我在哪个 phase 做事"；shutdown 时自动回收。
**风险**：与 fail-fast 语义需要协调；effect 内部抛错的处理策略需明确。

#### 借鉴 E：profile / patch layer 组合（中等改动量，仅在需要时做）

把 `plugins: [...]` 升级为：

```yaml
# nx-mk.config.yml
profiles:
  default:
    bundles: [plugin-swagger, plugin-typescript-sdk]
    patches: ./local-patches.yml
  ci:
    bundles: [plugin-swagger, plugin-typescript-sdk, plugin-coverage-gate]
```

仅在 nx-mk 需要支持多套插件组合（dev / prod / ci）时才做。当前 Phase 0-1 阶段可推迟。

### 3.4 不建议直接借鉴的部分

- dsh 的 HMR（hot module reload）机制复杂度高，nx-mk 当前用户场景不需要。
- dsh 的 profile discovery 涉及 `$DSH_HOME` 全局目录，nx-mk 当前以项目级 `.nx-mk/` 为产物目录，不引入全局态。

---

## 4. 插件系统 (Plugin system)

### 4.1 dsh 的做法

#### 4.1.1 三种插件形态（`vendor/cordis/src/registry.ts:91-145`）

```ts
type Plugin<T> =
  | Plugin.Function<T>      // (ctx, config) => any
  | Plugin.Constructor<T>   // new (ctx, config) => any
  | Plugin.Object<T>        // { apply(ctx, config) }
```

每种形态可声明：

```ts
interface Plugin.Base {
  name?: string
  Config?: StandardSchemaV1<any, T>   // 标准 schema 校验
  inject?: Inject                     // 依赖声明
  provide?: string | string[]         // 提供哪些服务
  intercept?: Dict<boolean>           // 消费哪些服务的 intercept
}
```

#### 4.1.2 Standard-Schema 校验

用 `@standard-schema/spec`（zod / valibot / arktype 都支持）校验插件配置。校验失败抛 `ValidationError`，聚合所有 issue 并显示路径：

```
invalid config:
  - openapi.servers[0].url: must be a URL
  - openapi.info.title: required
```

#### 4.1.3 @Inject 装饰器（`vendor/cordis/src/registry.ts:37-60`）

```ts
@Inject('logger')
class MyPlugin {
  // ctx.logger 在 fiber ACTIVE 时保证可用
}
```

`ctx.<name>` 仅 inject 过的服务；`ctx.get(name)` 取可选服务。

#### 4.1.4 异步校验 + 配置热更（`vendor/cordis/src/fiber.ts:736-753`）

```ts
update(config, noSave) {
  return this.context.waterfall(this, 'internal/update', config, noSave, () => {
    this.config = config
    return this.restart()  // dispose + reload
  })
}
```

支持监听器拦截 / 改写。

### 4.2 nx-mk 当前差距

`Plugin = { name, version, hooks }`，配置校验只看 `package.json` 的 name/version 字符串相等，无 schema 校验。

插件没有依赖声明，所有能力都通过 `PluginContext` 固定字段拿到。

`init` 阶段在 `kernel.ts` 里几乎空壳（"kernel default: no-op"），没有"等依赖"的等待语义。

不支持运行时配置更新。

### 4.3 可借鉴模式

#### 借鉴 F：引入 Standard-Schema 校验（小改动量，高价值）

让 `Plugin.Base` 支持 `Config?: StandardSchemaV1<any, T>`：

```ts
// plugin-swagger/src/index.ts
export const Config = z.object({
  openapi: z.object({
    path: z.string().min(1),
    servers: z.array(z.object({ url: z.string().url() })).min(1),
  }),
  output: z.object({
    dir: z.string(),
    format: z.enum(['json', 'yaml']).default('json'),
  }),
})

export default createPlugin((ctx) => ({
  name: 'plugin-swagger',
  version: '0.1.0',
  hooks: { ... },
}))
```

加载时 `plugin-registry.ts` 调 `Config['~standard'].validate(rawConfig)`，失败抛 `ValidationError` 并把所有 issue 写进 `error.log`。

**价值**：插件配置错误早失败、错误消息清晰；用户不需要看 nx-mk 源码就能改对配置。
**风险**：需要引入 zod / valibot 依赖；现有插件要补 Config schema。

#### 借鉴 G：声明式依赖 inject（小改动量）

允许插件在 factory 调用前声明依赖：

```ts
export default createPlugin({ inject: ['logger', 'events'] }, (ctx) => ({ ... }))
```

未声明 inject 但访问 `ctx.<name>` 时类型错误或运行时警告。`kernel.ts` 的 `initPlugins` 阶段等待所有 inject 都满足后再 ACTIVE。

**价值**：插件依赖关系显式化，重构安全。
**风险**：与现有 `PluginContext` 字段访问方式需要兼容（默认字段视为隐式 inject）。

#### 借鉴 H：插件配置热更（中等到大改动量，仅在需要时做）

提供 `api.reloadPlugin(name, newConfig)`：

1. dispose 旧 fiber（执行所有 effect disposers）
2. 校验新 config
3. 重新加载并启动新 fiber
4. 发 `plugin:reloaded` 事件

仅在 nx-mk 需要"长跑 daemon 监听文件变化"等场景时才做。当前 Phase 0 不需要。

### 4.4 不建议直接借鉴的部分

- dsh 的 `@Inject()` 装饰器依赖 TC39 stage 3 装饰器支持，nx-mk 当前 `tsconfig.base.json` 配置可能不兼容。改用 factory 注入即可达到同样效果。
- dsh 的 `intercept` / `isolate` / `extend` 三种 ctx 派生方式，对应多服务实例隔离场景，nx-mk 当前每个进程只有一个 ctx，不需要。

---

## 5. Loop 循环 (Loop)

### 5.1 dsh 的做法

#### 5.1.1 阶段判别联合 + 不可变快照（`packages/core/agent-loop/src/agent.ts:38-47`）

```ts
type Phase =
  | { kind: 'idle'; lastTurn: number }
  | { kind: 'maintenance'; abort: AbortController; lastTurn: number; wakeRequested: boolean }
  | { kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }
```

每种 phase 自带相关上下文（abort / turn / step / wakeRequested），编译期强制每种状态都要处理。

#### 5.1.2 Inbox 输入队列（`packages/core/agent-loop/src/agent.ts:94-98`）

```ts
this.inbox = new Inbox(session, {
  inserted: (message) => { ... },
  discarded: (message) => { ... },
  claimed: (message, turn) => { ... },
})
```

外部输入先入 inbox，loop 在每 turn 边界 claim → 处理 → 释放。事件流完整可重放。

#### 5.1.3 预构建 dispatcher + 零分配热路径（`packages/core/agent-loop/src/agent.ts:79, 93`）

```ts
private readonly dispatch: AgentEventDispatch
this.dispatch = agentEvents(loopCtx, this)  // 构造时建一次
```

hot path 不再分配。

### 5.2 nx-mk 当前差距

`run` 阶段几乎空壳，无 turn / step / inbox 概念；`KernelState.currentPhase: Phase | null` 只追踪阶段名而非阶段上下文。

事件 emit 每次走 `emitter.emit(type, event)`，未做 dispatcher 预构建（影响小，但 hot path 不优雅）。

### 5.3 可借鉴模式

#### 借鉴 I：RunPhase 判别联合（小改动量，仅在 nx-mk 需要 watch 模式时）

```ts
type RunPhase =
  | { kind: 'idle'; lastRunAt: number }
  | { kind: 'scanning'; target: string; abort: AbortController }
  | { kind: 'processing'; manifestId: string; abort: AbortController }
  | { kind: 'reporting'; reportPath: string }
```

仅在 nx-mk 需要做"watch 模式"（监听 OpenAPI 文件变化 → 重新解析 → 更新 manifest）时才做。当前 Phase 0 的 `run` 钩子机制保持简单即可。

#### 借鉴 J：Inbox 输入队列（中等到大改动量，仅在 watch 模式需要时）

外部触发入 inbox，loop 在当前 turn 完成后 claim 下一个任务：

```ts
ctx.inbox.enqueue({ kind: 'file-changed', path: 'openapi.yaml' })
```

仅当借鉴 I 落地后做。

#### 借鉴 K：高频事件预编译 dispatcher（极小改动量）

把 `phase:start` / `phase:end` / `plugin:loaded` 三类高频事件预编译为 typed emitter：

```ts
const phaseStartEmit = events.typed<{ type: 'phase:start'; ... }>()
phaseStartEmit({ phase, timestamp })  // 跳过字符串分发
```

**价值**：单次运行 50+ 事件时省下字符串分发开销（量级小但零成本）。
**风险**：当前规模下收益不明显，可在性能优化阶段再做。

### 5.4 不建议直接借鉴的部分

- dsh 的 ReactLoopAgent 整套（turn / step / wakeRequested）专为多轮 agent 对话设计，nx-mk 的 OpenAPI 解析是一次性批量任务，复杂度不匹配。
- dsh 的 Inbox 持久化到 session log，nx-mk 的产物走 `.nx-mk/runs/{runId}/` 单次目录，不需要跨 run 持久化。

---

## 6. 优先级矩阵

| 借鉴点 | nx-mk 改动量 | 价值 | 推荐阶段 |
|--------|--------------|------|----------|
| **C** 插件状态机 | 小 | 高（调试可观测性 + 错误恢复） | Phase 0 末期 |
| **F** Standard-Schema 校验 | 小 | 高（配置错误早失败） | Phase 1 |
| **B** 拆 manifest 为 Definition + Provider | 中 | 中（多 OpenAPI 来源时直接受益） | Phase 1 |
| **G** 声明式 inject | 小 | 中（依赖关系显式化） | Phase 1 |
| **A** PluginContext 注入式服务 | 中 | 中（解耦 ctx 形状） | Phase 2（若需要新增服务） |
| **D** Effect 次级副作用 | 中到大 | 高（长跑 daemon 场景） | Phase 2 |
| **I** RunPhase 判别联合 | 小 | 中（watch 模式基础） | Phase 2（若需要 watch） |
| **J** Inbox 输入队列 | 中到大 | 中（watch 模式 + 重入） | Phase 2（若需要 watch） |
| **E** profile / patch layer | 中 | 中（多套插件组合） | Phase 3（若有 dev/prod/ci 需求） |
| **H** 插件配置热更 | 大 | 中（长跑 daemon） | Phase 3（若有 daemon 需求） |
| **K** 预编译 dispatcher | 极小 | 低（性能优化） | 任意时机（优化阶段） |

---

## 7. 推荐落地路径（Phase 1 → Phase 2）

### Phase 1 推荐：先把三件高价值低成本的事做掉

1. **借鉴 C（插件状态机）**：升级 `KernelState` 与 `EventBus`，新增 `plugin:state-change` 事件。
2. **借鉴 F（Standard-Schema 校验）**：在 `plugin-registry.ts` 引入 zod，给 `plugin-swagger` 写第一个 Config schema 作为样板。
3. **借鉴 G（声明式 inject）**：让插件 factory 第一个参数声明依赖，类型层强制。

### Phase 2 推荐：基于是否需要 watch 模式分流

- **若需要 watch 模式**（OpenAPI 文件监听）：借鉴 I（RunPhase 判别联合）+ 借鉴 J（Inbox 输入队列）。
- **若不需要 watch 模式**：跳过 I/J，直接进入借鉴 D（Effect 次级副作用）以支持长跑 daemon 场景。

### 不建议做的（保留 nx-mk 当前简洁度）

- 不引入 ReflectService Proxy（过复杂）
- 不引入 `@Inject()` 装饰器（TC39 兼容性 + factory 注入已够用）
- 不引入 HMR / 异步校验 / `intercept` / `isolate` / `extend` ctx 派生（当前规模无此需求）

---

## 8. 风险与权衡

### 8.1 与当前测试体系的兼容

nx-mk 的 `packages/kernel/src/__tests__/` 有 6 个测试文件覆盖当前 API。引入借鉴 C/F/G 时需要：

- 给新增的状态 / schema / inject 机制补单元测试
- 保证现有测试（`kernel.test.ts` / `plugin-registry.test.ts`）继续通过

### 8.2 与 TypeScript 类型推导的兼容

- 借鉴 A（注入式服务）会让 `ctx.<name>` 的类型从字段访问变为注入查找，类型推断可能变弱。
- 借鉴 G（声明式 inject）的 factory 参数类型需要明确推导，避免 `any`。

### 8.3 与 dsh 演进方向的耦合

dsh 自身也在快速迭代（developer preview 阶段），其 Cordis API 可能再有变动。nx-mk 借鉴时**只取稳定的核心模式**（状态机、effect、standard-schema），避免直接依赖 dsh 的具体 API 形状。

---

## 9. 审阅要点

请重点关注以下决定：

1. **借鉴 C 是否纳入 Phase 0 末期？**（影响：错误恢复与可观测性的开发体验）
2. **借鉴 F 选 zod / valibot / arktype 中的哪个？**（影响：依赖体积 + 现有 API 风格）
3. **借鉴 B 是否在 Phase 1 就拆 manifest？**（影响：插件开发体验 + 多源支持的成本）
4. **借鉴 D / I / J 的触发条件**——nx-mk 是否在某个阶段需要 watch / daemon 模式？（影响：Phase 2 的方向）

待审阅人确认后，可进入具体的实现设计与代码评审。

---

## 附录 A：参考文件路径

### nx-mk 当前
- `packages/kernel/src/types.ts` — Phase / RunId / PHASES
- `packages/kernel/src/plugin.ts` — Plugin / PluginContext / KernelAPI
- `packages/kernel/src/plugin-registry.ts` — 加载链路
- `packages/kernel/src/hooks.ts` — 钩子执行器
- `packages/kernel/src/kernel.ts` — 5 阶段驱动器
- `packages/kernel/src/event-bus.ts` — 6 类事件
- `packages/manifest/src/` — Definition + Provider 当前未拆

### dsh（deepseek-harness）参考
- `.claude/repo/deepseek-harness/vendor/cordis/src/context.ts` — Context-as-Proxy
- `.claude/repo/deepseek-harness/vendor/cordis/src/fiber.ts` — 状态机 + effect
- `.claude/repo/deepseek-harness/vendor/cordis/src/registry.ts` — 三种插件形态 + @Inject
- `.claude/repo/deepseek-harness/vendor/cordis/src/events.ts` — 5 种 dispatch 模式
- `.claude/repo/deepseek-harness/packages/core/agent-loop/src/agent.ts` — ReactLoopAgent
- `.claude/repo/deepseek-harness/packages/boot/app-boot/src/profile.ts` — profile + patch layer
- `.claude/repo/deepseek-harness/CLAUDE.md` — Cordis 顶层约定
- `.claude/repo/deepseek-harness/packages/CLAUDE.md` — 包级约定（含 capability seam）

---

**报告结束** · 等待审阅
