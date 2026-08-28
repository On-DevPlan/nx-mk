# nx-mk 基础稳定性与扩展性修改方案

> **修改方案（供审阅）** · 生成日期: 2026-08-28
> 范围: 微内核 + 插件系统（基础层）
> 前置: [`2026-08-28-dsh-borrow-review.md`](./2026-08-28-dsh-borrow-review.md) 借鉴评估

---

## 1. 目标

### 1.1 项目背景

nx-mk 是渐进式扩展项目。当前处于 Phase 0，已经完成：

- `kernel`（5 阶段生命周期 + 钩子执行器 + 事件总线 + 错误系统）
- `config`（配置 schema + loader）
- `manifest`（OpenAPI → Manifest）
- `plugin-swagger`（OpenAPI 适配插件）

即将进入 Phase 1 与 Phase 2。届时会有：

- 多个 OpenAPI 来源（不只是 Swagger，可能加入 Postman / GraphQL）
- 多个 SDK 生成器（TypeScript / Python / Go …）
- 多个分析维度（coverage / lint / diff）
- 可能的 watch / daemon 模式

### 1.2 本方案目标

**稳定基础层** —— 让后续扩展不会破坏现有 API：

1. **稳定性**：内核 API 在 Phase 1-3 期间不发生破坏性变更
2. **可观测性**：每个插件的生命周期状态对外可见
3. **可扩展性**：新增能力不需要修改内核或现有插件
4. **类型安全**：内核与插件之间的契约由 TypeScript 强制

### 1.3 非目标（明确不做）

- 不引入 watch / daemon 模式（Phase 2 再考虑）
- 不引入 effect 系统（Phase 2 再考虑）
- 不引入 profile / patch layer（Phase 3 再考虑）
- 不引入运行时配置热更（Phase 3 再考虑）
- 不引入 ReflectService Proxy（永久不做，规模不匹配）

---

## 2. 范围

### 2.1 在范围内

| 范围 | 内容 |
|------|------|
| `packages/kernel/` | 插件状态机 / 注入系统 / 错误强化 / 类型强化 |
| `packages/manifest/` | 拆分为 Definition + Provider |
| `packages/plugin-swagger/` | 跟随 manifest 拆分 |
| **新增** `packages/schema/` | Standard-Schema 适配层 |
| 测试体系 | 现有测试 + 新增测试 |
| 文档 | README / JSDoc / 迁移指南 |

### 2.2 不在范围内

- CLI 改造（Phase 1 单独评估）
- config loader 改造（当前够用）
- 输出格式（report / coverage）
- 性能优化（hot path dispatcher 等）

---

## 3. 设计原则

### 3.1 向后兼容优先

所有改动必须是**加性的**（additive）：

- 新增类型字段用 `?:` 可选
- 新增钩子用可选键集
- 现有插件（factory only）继续可用
- 现有 config 文件继续可用
- 现有事件订阅继续有效

### 3.2 渐进式采纳

每个里程碑独立可用、独立可审：

- 完成里程碑 M 后代码可以独立提交 / 独立回滚
- 测试覆盖率不下降（每个 M 完成后 ≥ 当前基线）
- 文档随代码同步更新

### 3.3 类型即契约

所有内核边界用 TypeScript 类型表达：

- `Plugin` / `PluginContext` / `PluginHooks` 是公开契约
- 错误码是稳定字符串（`KernelError.Code` 枚举）
- `RunId` / `PluginName` 用 branded type
- 判别联合必有 `assertNever` 收尾

### 3.4 文档同步

- 每个里程碑必须更新 README / JSDoc
- 新增 API 必须有 `@example` 块
- 破坏性变更必须先写迁移指南再改代码

---

## 4. 里程碑设计

### M1：插件状态机 + 可观测性

**目标**：让每个插件的状态对外可见，错误恢复路径清晰。

**改动清单**：

| 文件 | 改动 |
|------|------|
| `packages/kernel/src/types.ts` | 新增 `PluginState` 判别联合 + `PluginStatusEvent` 类型 |
| `packages/kernel/src/event-bus.ts` | `KernelEvent` 新增 `plugin:state-change` |
| `packages/kernel/src/plugin-registry.ts` | 在 `loadPlugins` 关键节点发状态事件 |
| `packages/kernel/src/kernel.ts` | `KernelState.loadedPlugins: string[]` → `pluginStates: Map<string, PluginState>` |
| `packages/kernel/src/__tests__/plugin-registry.test.ts` | 新增状态转换测试 |
| `packages/kernel/src/__tests__/kernel.test.ts` | 新增可观测性测试 |
| `packages/kernel/README.md` | 文档化状态机 + 事件 |

**新增类型**：

```ts
export type PluginState =
  | { kind: 'pending'; waitedFor: string[] }
  | { kind: 'loading' }
  | { kind: 'active'; activatedAt: string }
  | { kind: 'failed'; error: { code: string; message: string } }
  | { kind: 'unloading' }
  | { kind: 'disposed' }
```

**新增事件**：

```ts
| {
    type: 'plugin:state-change'
    name: string
    from: PluginState['kind']
    to: PluginState['kind']
    timestamp: string
    error?: { code: string; message: string }
  }
```

**验收标准**：

- [ ] 现有 6 个测试文件全部通过
- [ ] 新增测试覆盖：加载成功、加载失败、运行时失败、shutdown 顺序
- [ ] `getState()` 返回的 `pluginStates` Map 在每个阶段都正确反映
- [ ] 外部工具可通过 `events.on('plugin:state-change', ...)` 订阅
- [ ] JSDoc 完整 + 中文注释保留

**风险**：

- 状态转换逻辑可能漏边界（如：加载失败后能否重试？）
- 缓解：先列状态机所有合法转换表格，再实现

**预计工作量**：3-5 天

---

### M2：Standard-Schema 校验

**目标**：让插件配置错误早失败，错误消息友好。

**改动清单**：

| 文件 | 改动 |
|------|------|
| **新增** `packages/schema/` | 适配层，导出 `validateConfig` 工具 |
| **新增** `packages/schema/src/index.ts` | 标准 schema 类型 + 校验函数 |
| **新增** `packages/schema/src/errors.ts` | `ValidationError` + 路径聚合 |
| **新增** `packages/schema/__tests__/` | 单元测试 |
| `packages/kernel/src/plugin.ts` | `Plugin` 接口新增 `configSchema?: StandardSchemaV1` |
| `packages/kernel/src/plugin-registry.ts` | 在 `validateShape` 之后调 `validateConfig` |
| `packages/kernel/src/errors.ts` | 新增错误码 `PLUGIN_CONFIG_INVALID` |
| `packages/plugin-swagger/src/index.ts` | 第一个声明 `configSchema` 的插件样板 |
| `packages/plugin-swagger/README.md` | 文档化 schema 用法 |
| `packages/kernel/README.md` | 文档化 Config schema 约定 |

**新增 API**：

```ts
// packages/schema/src/index.ts
export interface StandardSchemaV1<Input, Output> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardSchemaV1.Result<Output>
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}

export function validateConfig<T>(
  schema: StandardSchemaV1<unknown, T>,
  rawConfig: unknown,
): T  // throws ValidationError
```

```ts
// packages/kernel/src/plugin.ts
export interface Plugin {
  name: string
  version: string
  hooks: PluginHooks
  configSchema?: StandardSchemaV1<unknown, unknown>  // ← 新增可选
  inject?: string[]                                  // ← M3 提前预留
}
```

**校验流程**（`plugin-registry.ts`）：

```ts
// 在 validateShape 之后、push 进 plugins 之前
if (plugin.configSchema) {
  try {
    plugin.config = validateConfig(plugin.configSchema, rawConfig)
  } catch (err) {
    throw new KernelError(
      'PLUGIN_CONFIG_INVALID',
      `Plugin '${name}' config invalid: ${err.message}`,
      err,
    )
  }
}
```

**验收标准**：

- [ ] zod / valibot / arktype 三种 schema 库都能被适配（至少 zod 完整测试）
- [ ] `plugin-swagger` 声明完整 Config schema 作为样板
- [ ] 校验失败时错误日志包含完整路径（如 `openapi.servers[0].url`）
- [ ] 现有插件（无 schema）继续工作
- [ ] 退出码映射更新（`PLUGIN_CONFIG_INVALID` → 退出码 6）

**风险**：

- 标准 schema 类型推导可能与 zod 版本冲突
- 缓解：把 zod 声明为 peerDependencies，nx-mk 不直接依赖

**预计工作量**：5-7 天（含样板插件改造）

---

### M3：声明式 inject

**目标**：让插件依赖关系显式化，重构安全。

**改动清单**：

| 文件 | 改动 |
|------|------|
| `packages/kernel/src/plugin.ts` | `Plugin.inject?: string[]` 字段 |
| `packages/kernel/src/plugin.ts` | `PluginContext` 拆分：declared services vs ad-hoc |
| `packages/kernel/src/types.ts` | `KernelService` 标识核心服务名（`'logger'` / `'events'` 等） |
| `packages/kernel/src/plugin-registry.ts` | 加载后做"依赖满足性"检查 |
| `packages/kernel/src/kernel.ts` | `initPlugins` 阶段真正有意义：等待所有依赖 |
| `packages/kernel/src/__tests__/plugin-registry.test.ts` | 新增依赖顺序测试 |
| `packages/kernel/src/__tests__/kernel.test.ts` | 新增 init 阶段等待测试 |
| `packages/kernel/README.md` | 文档化 inject 约定 |

**`PluginContext` 拆分**：

```ts
// 当前：扁平字段
interface PluginContext {
  config: ResolvedConfig
  logger: Logger
  events: EventBus
  kernel: KernelAPI
  cwd: string
}

// M3 后：核心服务 vs 用户定义
interface PluginContext {
  // 核心服务（无需声明）
  config: ResolvedConfig
  kernel: KernelAPI
  cwd: string
  
  // 显式 inject（按声明提供）
  logger: Logger     // 需 inject: ['logger']
  events: EventBus   // 需 inject: ['events']
}
```

**依赖满足性检查**：

```ts
// kernel.ts initPlugins 阶段
async function resolveDependencies(plugins: Plugin[]): Promise<void> {
  const provided = new Set<string>()
  // 第一轮：找出所有 provide 的服务名
  for (const p of plugins) {
    if (p.provide) for (const name of p.provide) provided.add(name)
  }
  // 第二轮：检查每个插件的 inject 是否全部满足
  for (const p of plugins) {
    const missing = (p.inject ?? []).filter(name => !provided.has(name))
    if (missing.length > 0) {
      throw new KernelError(
        'PLUGIN_DEPENDENCY_MISSING',
        `Plugin '${p.name}' requires [${missing.join(', ')}] which no other plugin provides`,
      )
    }
  }
}
```

**新增可选字段**：

```ts
export interface Plugin {
  // ... 已有字段
  inject?: string[]      // 依赖的服务名
  provide?: string[]     // 对外提供的服务名（Phase 2 再深度使用）
}
```

**验收标准**：

- [ ] 不声明 inject 的旧插件继续工作（logger/events 默认可用）
- [ ] 声明 inject 的插件被严格按依赖顺序加载
- [ ] 缺失依赖时 `PLUGIN_DEPENDENCY_MISSING` 错误 + 退出码
- [ ] 测试覆盖：单插件 / 链式依赖 / 循环依赖检测

**风险**：

- 循环依赖（A 依赖 B，B 依赖 A）需要检测
- 缓解：DFS 检测环路 + 错误信息明确指出环路

**预计工作量**：5-7 天

---

### M4：Manifest 拆分（Definition + Provider）

**目标**：为多 OpenAPI 来源（Postman / GraphQL）打基础。

**改动清单**：

| 文件 | 改动 |
|------|------|
| **新增** `packages/manifest-schema/` | Definition：types / field-id / schema-walker / normalizer |
| **新增** `packages/manifest-schema/src/index.ts` | 重新导出公共 API |
| `packages/manifest/` | 改造为 Provider 角色：保留 parser + 新增 plugin 入口 |
| `packages/manifest/` | 改名 / 重新定位为 OpenAPI Provider |
| `packages/plugin-swagger/` | 改依赖 `@mk/manifest-schema` + `@mk/manifest-openapi` |
| `packages/plugin-swagger/src/__tests__/` | 测试迁移到新结构 |
| `packages/manifest-schema/README.md` | Definition 角色文档 |
| `packages/manifest/README.md` | Provider 角色文档 |

**拆分边界**：

| 当前文件 | 新归属 |
|----------|--------|
| `manifest/src/types.ts` | `manifest-schema/src/types.ts` |
| `manifest/src/field-id.ts` | `manifest-schema/src/field-id.ts` |
| `manifest/src/schema-walker.ts` | `manifest-schema/src/schema-walker.ts` |
| `manifest/src/normalizer.ts` | `manifest-schema/src/normalizer.ts` |
| `manifest/src/parser.ts` | `manifest/src/parser.ts`（OpenAPI 解析保留） |
| `manifest/src/index.ts` | `manifest/src/index.ts`（OpenAPI Provider 入口） |

**Capability seam 形态**：

```
manifest-schema (Definition)     ← 任何 Provider 都依赖
    ↑
manifest-openapi (Provider)      ← 当前 plugin-swagger 依赖
manifest-postman (Provider)      ← 未来 Phase 2+
manifest-graphql (Provider)      ← 未来 Phase 2+
```

**验收标准**：

- [ ] `@mk/manifest-schema` 独立可发包
- [ ] `@mk/manifest-openapi`（即原 `manifest`）依赖 schema 包
- [ ] `plugin-swagger` 改造后行为完全等价
- [ ] 现有测试全部通过
- [ ] README 文档化 Capability seam 概念

**风险**：

- 包名变更可能影响外部引用
- 缓解：保留 `@mk/manifest` 作为 OpenAPI Provider 的别名，添加 deprecation 提示

**预计工作量**：3-5 天（含文档）

---

### M5：类型强化（配套）

**目标**：让类型即契约。

**改动清单**：

| 文件 | 改动 |
|------|------|
| `packages/kernel/src/types.ts` | `RunId` 改为 branded type |
| `packages/kernel/src/types.ts` | 新增 `PluginName` branded type |
| `packages/kernel/src/types.ts` | 新增 `PhaseName` branded type |
| `packages/kernel/src/errors.ts` | `KernelError.Code` 改为 const enum |
| `packages/kernel/src/event-bus.ts` | `emit` 函数加 `assertNever` 收尾 |
| `packages/kernel/src/hooks.ts` | hook 派发加 `assertNever` |
| `packages/kernel/src/kernel.ts` | `runPhase` switch 加 `assertNever` |
| `packages/kernel/src/__tests__/event-bus.test.ts` | 新增未处理类型测试 |
| 全包 | JSDoc 补 `@example` 块 |

**branded type 工具**（`packages/kernel/src/types.ts`）：

```ts
declare const __brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [__brand]: B }

export type RunId = Brand<string, 'RunId'>
export type PluginName = Brand<string, 'PluginName'>
export type PhaseName = Brand<Phase, 'PhaseName'>
```

**assertNever 工具**：

```ts
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}
```

**验收标准**：

- [ ] 所有 `string` 类型的 ID 改为 branded
- [ ] 所有判别联合 switch 加 assertNever
- [ ] TypeScript `strict: true` 不放宽
- [ ] 现有测试全部通过

**风险**：

- branded type 在 JSON 序列化时会丢失品牌（运行时只是普通 string）
- 缓解：序列化前 `as RunId` 重新打品牌；JSDoc 标注"运行时无类型检查"

**预计工作量**：2-3 天

---

## 5. 里程碑依赖关系

```
M1 (状态机)
  │
  └─→ M2 (Standard-Schema)
        │
        └─→ M3 (Inject)
              │
              └─→ M4 (Manifest 拆分)
                    │
                    └─→ M5 (类型强化)   ← 可与 M3/M4 并行
```

- M1 是基础设施，必须先做
- M2 依赖 M1 的事件系统发 schema 校验失败
- M3 依赖 M2 的错误码（PLUGIN_CONFIG_INVALID → PLUGIN_DEPENDENCY_MISSING）
- M4 与 M3 并行（无强依赖）
- M5 任何阶段可穿插做（独立小任务）

---

## 6. 时间估算

| 里程碑 | 工作量（人天） | 累计 |
|--------|----------------|------|
| M1 状态机 | 3-5 | 3-5 |
| M2 Schema | 5-7 | 8-12 |
| M3 Inject | 5-7 | 13-19 |
| M4 拆分 | 3-5 | 16-24 |
| M5 类型强化 | 2-3 | 18-27 |

**总估算：3-5 周（含 review + 文档）**

---

## 7. 测试策略

### 7.1 每个里程碑的测试要求

- **新功能测试**：每个新增 API 至少 3 个测试（happy path / boundary / failure）
- **回归测试**：现有 6 个测试文件必须 100% 通过
- **集成测试**：plugin-swagger + kernel 联合跑一次完整 run

### 7.2 测试覆盖矩阵（目标）

| 模块 | 当前覆盖 | M1 后 | M2 后 | M3 后 | M4 后 | M5 后 |
|------|----------|-------|-------|-------|-------|-------|
| types.ts | 无 | 100% | 100% | 100% | 100% | 100% |
| errors.ts | 100% | 100% | 100% | 100% | 100% | 100% |
| event-bus.ts | 100% | 100% | 100% | 100% | 100% | 100% |
| hooks.ts | 100% | 100% | 100% | 100% | 100% | 100% |
| logger.ts | 100% | 100% | 100% | 100% | 100% | 100% |
| plugin-registry.ts | 100% | 100% | 100% | 100% | 100% | 100% |
| kernel.ts | 100% | 100% | 100% | 100% | 100% | 100% |
| schema/ | - | - | 100% | 100% | 100% | 100% |
| inject resolver | - | - | - | 100% | 100% | 100% |
| manifest-schema | - | - | - | - | 100% | 100% |

### 7.3 集成测试

每个 M 完成后跑一次完整 happy path：

```ts
const api = createKernel({ ... })
const result = await api.run()
// 验证：所有 phase 触发、events.jsonl 内容、kernel.log 完整
```

---

## 8. 迁移策略

### 8.1 向后兼容保证

| 改动 | 兼容策略 |
|------|----------|
| `PluginState` 新增 | 仅 `getState()` 返回值多字段；旧调用方忽略多余字段即可 |
| `plugin:state-change` 事件新增 | 旧订阅者不订阅此事件即可 |
| `configSchema` 新增 | 不声明的插件跳过校验 |
| `inject` 新增 | 不声明的插件 logger/events 仍可用（默认隐式注入） |
| `provide` 新增 | 不声明的插件不参与依赖图 |
| branded types | 运行时是 string；序列化无影响；类型层强制 |
| `manifest` 拆分 | `@mk/manifest` 别名保留一段时间 |

### 8.2 现有插件迁移

`packages/plugin-swagger/`：

- M2 后：声明 `configSchema`（样板）
- M4 后：依赖改为 `@mk/manifest-schema` + `@mk/manifest-openapi`
- 钩子逻辑不变

### 8.3 文档迁移

- 每个 M 的 PR 包含 README 更新
- `docx/plan/migration-guide.md` 记录所有非兼容性变更
- 旧 API 标记 `@deprecated` 不在 Phase 1-2 移除（避免破坏）

---

## 9. 风险登记

| 风险 | 等级 | 缓解 |
|------|------|------|
| M3 inject 顺序问题导致现有插件失效 | 高 | 默认 inject 隐式可用 + 完整回归测试 |
| M4 包拆分破坏外部 import | 中 | 保留 `@mk/manifest` 别名 + deprecation 提示 |
| M2 zod 版本与 TypeScript 不兼容 | 中 | zod 声明为 peerDependencies |
| M1 状态机漏边界导致状态错乱 | 中 | 状态转换表格 + 单元测试覆盖所有路径 |
| M5 branded type 在 JSON 序列化丢失 | 低 | 序列化点用 `as RunId` 重打品牌 |
| 整体进度超期 | 中 | 每个 M 可独立交付 / 回滚 |

---

## 10. 决策点

需要审阅人确认：

1. **里程碑顺序**：按 M1→M2→M3→M4→M5 顺序是否合理？
2. **时间估算**：3-5 周是否可接受？需要拆分到多个 sprint 吗？
3. **zod 选型**：是否同意用 zod 作为默认 schema 库？或者倾向 valibot / arktype？
4. **manifest 拆分粒度**：M4 是拆成 `manifest-schema` + `manifest-openapi`，还是合并到 `plugin-swagger` 内部？
5. **branded type 范围**：M5 是否对所有 ID 用 branded？还是仅 `RunId`？
6. **现有 config 文件格式**：是否在 M1-M5 期间保持不变？还是趁机引入 schema 校验 `nx-mk.config.yml` 本身？

---

## 11. 审阅签收

待审阅人确认上述决策点后，进入实现阶段。建议流程：

1. 决策点确认 → 锁定方案
2. M1 实现 + 测试 + 文档 + PR
3. 合并 M1 后启动 M2
4. 每周 review 一次进度
5. 全部完成后做一次完整的回归测试

---

## 附录 A：参考文件

### 当前 nx-mk 关键文件

- `packages/kernel/src/types.ts`
- `packages/kernel/src/plugin.ts`
- `packages/kernel/src/plugin-registry.ts`
- `packages/kernel/src/kernel.ts`
- `packages/kernel/src/event-bus.ts`
- `packages/kernel/src/errors.ts`
- `packages/kernel/src/hooks.ts`
- `packages/manifest/src/` (待拆分)
- `packages/plugin-swagger/src/`
- `packages/kernel/src/__tests__/` (6 个测试文件)

### dsh 参考

- `.claude/repo/deepseek-harness/vendor/cordis/src/fiber.ts` — 状态机 + effect
- `.claude/repo/deepseek-harness/vendor/cordis/src/registry.ts` — Plugin.Base 形态 + Standard-Schema
- `.claude/repo/deepseek-harness/vendor/cordis/src/utils.ts` — branded types 工具
- `.claude/repo/deepseek-harness/packages/CLAUDE.md` — Capability seam 约定

---

**修改方案结束** · 等待审阅
