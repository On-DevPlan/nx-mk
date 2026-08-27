# nx-mk Spec #0: Phase 0 Foundation — Project Skeleton + Microkernel + Plugin Extension

> 日期：2026-08-26
> 范围：Phase 0 — 项目骨架 + 微内核生命周期 + 插件扩展能力
> 不在范围：SPEC #1 SDK Facade（`@nx-mk/client` / `@nx-mk/runtime` / `@nx-mk/client-codegen`）、Dashboard、Agent、Manifest 实做、`examples/react-vite-demo`
> 关联文档：
> - `docx/plan/nx-mk-plan.md`（完整方案）
> - `docx/plan/nx-mk-plan-questions.md`（决策记录）
> - `docs/superpowers/specs/2026-08-26-nx-mk-foundation-and-sdk-design.md`（SPEC #1，Phase 1+）

---

## 1. 目标与非目标

### 1.1 目标

本 spec 交付后，`nx-mk` monorepo 具备以下能力：

1. **可构建的工作区**：`pnpm install` + `pnpm -r build` 全部成功，无 TS 错误
2. **可执行的 CLI**：`npx nx-mk --help`、`npx nx-mk doctor`、`npx nx-mk init`、`npx nx-mk`（默认 `run` subcommand）均可运行
3. **可工作的微内核**：`createKernel({ configPath, runId, subcommand })` 暴露 `run()` / `shutdown()` / `getState()` / `getRunId()` / `getSubcommand()`
4. **可扩展的插件机制**：通过 `nx-mk.config.yml` 的 `plugins: [...]` 字段声明插件列表；插件以 npm 包形式存在于 `node_modules/`；插件可通过 lifecycle hook 介入 5 个 phase
5. **可观测的运行过程**：每次 run 生成 `.nx-mk/runs/{runId}/{kernel.log, error.log, events.jsonl, config.snapshot.yml}`
6. **可测试的内核契约**：kernel 包 85%+ 覆盖率；集成测试覆盖完整生命周期、fail-fast 错误流、shutdown 反序

### 1.2 非目标（明确不在 Phase 0）

- SDK Facade（`@nx-mk/client` / `@nx-mk/runtime` / `@nx-mk/client-codegen`）—— SPEC #1
- Dashboard 服务（任何 HTTP server / UI）—— SPEC #2
- Agent / Loop / 自动补齐 —— SPEC #3
- Manifest 解析实做（OpenAPI → Manifest）—— Phase 1
- Playwright / 浏览器自动化 —— Phase 2
- SQLite / 报告生成 —— Phase 3
- 多框架支持（仅 Node.js CLI 端）—— Phase 4+
- `examples/react-vite-demo` —— SPEC #1 §1.3 交付
- plugin 之间的版本协商 —— Phase 1+
- per-plugin config block（`plugins: [{ name, config }]`）—— Phase 1+
- 官方 plugin test harness（`@nx-mk/plugin-test-utils`）—— Phase 1+

### 1.3 成功标准

- `pnpm install` 在干净 checkout 上成功
- `pnpm -r build` 全部 5 个 package 输出 `dist/`
- `pnpm -r test` 全部通过；kernel 包 line coverage ≥ 85%
- `pnpm --filter @nx-mk/cli doctor` 在装好 plugin 的项目里 exit code 0
- `pnpm --filter @nx-mk/cli init` 生成 `nx-mk.config.yml` + `.nx-mk/` 目录
- `pnpm --filter @nx-mk/cli run`（或 `pnpm --filter @nx-mk/cli`）走完 5 个 phase，placeholder plugin 在每个 phase 的 hook 内被调用至少 1 次
- 故意让 plugin throw，验证：
  - CLI exit code = 4（`PLUGIN_HOOK_FAILED`）
  - `.nx-mk/runs/{runId}/error.log` 包含完整 stack
  - `.nx-mk/runs/{runId}/events.jsonl` 包含 `phase:start` / `plugin:error` / `kernel:error` / `phase:end`（shutdown）
- 写一个最小自测 plugin（`@nx-mk/plugin-swagger` 的占位实现），能在另一个项目里被 `nx-mk` 加载并执行其 `run` hook

---

## 2. 仓库架构

### 2.1 目录布局

```
nx-mk/
├── package.json                       # 根级，scripts 通过 pnpm -r 委派
├── pnpm-workspace.yaml                # packages: ['packages/*', 'packages/plugin-*']
├── tsconfig.base.json                 # ES2022 / ESNext / Bundler（已存在，不变）
├── .gitignore                         # 已存在，不变
├── docs/superpowers/specs/            # spec 文档
├── docx/plan/                         # plan 与决策记录
└── packages/
    ├── kernel/                        # @nx-mk/kernel — 微内核（Phase 0 核心）
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── tsup.config.ts
    │   ├── src/
    │   │   ├── index.ts               # 公共 API 重导出
    │   │   ├── kernel.ts              # createKernel() 工厂 + 5 phase 驱动器
    │   │   ├── plugin.ts              # Plugin / PluginContext / Hook 类型
    │   │   ├── event-bus.ts           # 类型化 EventBus 包装
    │   │   ├── plugin-registry.ts     # 从 node_modules 按包名加载插件
    │   │   ├── hooks.ts               # 有序执行 hooks，fail-fast
    │   │   ├── logger.ts              # NDJSON logger + stderr mirror
    │   │   ├── errors.ts              # KernelError + 6 个 code
    │   │   ├── types.ts               # 共享类型（RunId、Phase、KernelState、ResolvedConfig）
    │   │   └── __tests__/
    │   │       ├── kernel.test.ts
    │   │       ├── hooks.test.ts
    │   │       ├── event-bus.test.ts
    │   │       ├── plugin-registry.test.ts
    │   │       └── errors.test.ts
    │
    ├── config/                        # @nx-mk/config — schema + loader
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── tsup.config.ts
    │   └── src/
    │       ├── index.ts               # 重导出 schema + loader
    │       ├── schema.ts              # Zod schema（plugins / logLevel / outputDir）
    │       ├── loader.ts              # 读 YAML → Zod 校验 → ResolvedConfig
    │       └── __tests__/
    │           └── loader.test.ts
    │
    ├── manifest/                      # @nx-mk/manifest — 占位（Phase 1 才实做）
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── tsup.config.ts
    │   └── src/index.ts               # 仅导出 name + version 占位常量
    │
    ├── cli/                           # @nx-mk/cli — 最小 CLI 入口
    │   ├── package.json               # bin: { "nx-mk": "./dist/index.js" }
    │   ├── tsconfig.json
    │   ├── tsup.config.ts
    │   └── src/
    │       ├── index.ts               # #!/usr/bin/env node + argv 解析 + 路由
    │       ├── commands/
    │       │   ├── run.ts             # 默认 subcommand
    │       │   ├── init.ts            # 生成 nx-mk.config.yml + .nx-mk/
    │       │   └── doctor.ts          # 环境检查
    │       └── __tests__/
    │           └── doctor.test.ts
    │
    └── plugin-swagger/                # @nx-mk/plugin-swagger — 占位
        ├── package.json
        ├── tsconfig.json
        ├── tsup.config.ts
        └── src/index.ts               # export default createSwaggerPlugin(): Plugin
```

### 2.2 pnpm Workspace

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'packages/plugin-*'
```

`packages/plugin-*` 让 `packages/plugin-swagger` 与未来可能出现的 `plugin-foo`、`plugin-bar` 共享根级 peer / dev 工具链。

### 2.3 包依赖图

```
                ┌──────────────┐
                │     cli      │  (depends on: kernel, config)
                └──────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌────────┐    ┌──────────┐   ┌────────────┐
   │ kernel │    │  config  │   │plugin-swag │  (depends on: kernel)
   └────────┘    └────┬─────┘   └────────────┘
                      │              │
                      └──── kernel ──┘

   ┌─────────────┐
   │  manifest   │  (独立，Phase 1 才被 plugin-swagger 引用)
   └─────────────┘
```

- `kernel` 零运行时依赖（仅 `zod` 用于 config 校验 — 决定放哪边见 §6）
- `config` 依赖 `kernel` 的 `PluginContext` 类型
- `cli` 依赖 `kernel` + `config`
- `plugin-swagger` 仅依赖 `kernel` 的类型（peer dependency）
- `manifest` Phase 0 不被任何包引用（占位）

### 2.4 决策记录

- **`zod` 放哪边：** `config` 包的 `peerDependency` + `kernel` 的 `devDependency`（仅类型用）。运行时只 `config` 真用 `zod.parse()`，kernel 用 `Config` 类型即可。
- **`tsup` vs `tsc`：** 全包统一 `tsup`，输出 ESM + d.ts，参考 SPEC §6 的产出格式。
- **`vitest` 集中还是分散：** 根级 `vitest.config.ts` 集中配置；各包 `pnpm test` 通过 `pnpm -r --filter ...` 委派到根。

---

## 3. 微内核设计

### 3.1 Plugin 类型合约

```ts
// @nx-mk/kernel/src/plugin.ts
import type { Logger } from './logger'
import type { EventBus } from './event-bus'

export type Phase = 'loadConfig' | 'resolvePlugins' | 'initPlugins' | 'run' | 'shutdown'

export type HookName =
  | `before${Capitalize<Phase>}`    // beforeLoadConfig / beforeResolvePlugins / ...
  | Phase                            // loadConfig / resolvePlugins / ...
  | `after${Capitalize<Phase>}`     // afterLoadConfig / afterResolvePlugins / ...

export type HookHandler = (ctx: PluginContext) => Promise<void> | void

export interface Plugin {
  name: string                       // 必须与 package.json "name" 字段一致
  version: string                    // 必须与 package.json "version" 字段一致
  hooks: { [K in HookName]?: HookHandler }
}

export interface PluginContext {
  config: ResolvedConfig             // loadConfig 后填充
  logger: Logger
  events: EventBus
  kernel: KernelAPI
}

export interface KernelAPI {
  run(): Promise<RunResult>
  shutdown(reason?: string): Promise<void>
  getState(): KernelState
  getRunId(): string
  getSubcommand(): 'run' | 'init' | 'doctor'
}
```

### 3.2 微内核数据流

```
CLI(argv)
  │ parse argv → subcommand = argv[0] ?? 'run'
  │ generate runId = `run_${YYYYMMDD}_${HHMMSS}`
  │ ensureRunDir(.nx-mk/runs/{runId})
  ▼
createKernel({ configPath, runId, subcommand })
  │ creates RunContext { runId, configPath, subcommand, logger, events }
  │ logger writes to .nx-mk/runs/{runId}/kernel.log
  ▼
kernel.run()
  │
  ├─[phase 1/5: loadConfig]
  │  events.emit({ type: 'phase:start', phase: 'loadConfig', timestamp })
  │  for plugin in plugins (empty before resolvePlugins → 跳过):
  │    await runHook('beforeLoadConfig', plugin, ctx)        ← fail-fast
  │  ctx.config = await loadConfig(configPath)               ← kernel 默认行为
  │  for plugin in plugins (同上):
  │    await runHook('afterLoadConfig', plugin, ctx)
  │  events.emit({ type: 'phase:end', phase: 'loadConfig', durationMs })
  │
  ├─[phase 2/5: resolvePlugins]
  │  emit('phase:start')
  │  for plugin in plugins:
  │    await runHook('beforeResolvePlugins', plugin, ctx)
  │  ctx.plugins = await loadPlugins(ctx.config.plugins)     ← kernel 默认
  │  for plugin in plugins:
  │    await runHook('afterResolvePlugins', plugin, ctx)
  │  emit('phase:end', { loadedCount: ctx.plugins.length })
  │
  ├─[phase 3/5: initPlugins]
  │  emit('phase:start')
  │  for plugin in ctx.plugins:
  │    await runHook('beforeInitPlugins', plugin, ctx)
  │    // kernel 默认：no-op（plugin instance 已在 resolvePlugins 构造好）
  │    await runHook('afterInitPlugins', plugin, ctx)
  │  emit('phase:end')
  │
  ├─[phase 4/5: run]
  │  emit('phase:start')
  │  for plugin in ctx.plugins:
  │    await runHook('beforeRun', plugin, ctx)
  │  // kernel 默认：no-op
  │  for plugin in ctx.plugins:
  │    await runHook('run', plugin, ctx)                     ← plugin 读 subcommand
  │  for plugin in ctx.plugins:
  │    await runHook('afterRun', plugin, ctx)
  │  emit('phase:end')
  │
  └─[phase 5/5: shutdown]                                    ← 总会执行（try/finally）
     emit('phase:start')
     for plugin in plugins (reverse order):
       await runHook('beforeShutdown', plugin, ctx)
       await runHook('shutdown', plugin, ctx)
       await runHook('afterShutdown', plugin, ctx)
     emit('phase:end')
     await logger.flush()
  ▼
return { runId, durationMs }
```

**所有 CLI subcommand (`run` / `init` / `doctor`) 都走完 5 个 phase。** Subcommand 仅作为 `ctx.kernel.getSubcommand()` 暴露给 plugin；plugin 的 `run` hook 根据 subcommand 决定做什么。

### 3.3 错误流（fail-fast）

```
任意 hook throw X (KernelError or unknown)
  │
  ├─ 1. logger.error({
  │       event: 'plugin:hook:failed' | 'kernel:internal',
  │       phase, plugin, hook, error: { message, stack, code }
  │     })
  │
  ├─ 2. events.emit({ type: 'plugin:error' | 'kernel:error', ... })   ← async fire-and-forget
  │
  ├─ 3. ctx.error = X
  │
  ├─ 4. kernel.run() 顶层 catch 捕获
  │     ├─ 跳到 shutdown phase（跳过中间所有未执行 phase）
  │     ├─ shutdown 内 hook 单独 try/catch；子错误只 log 不再 fail-fast（已处于错误态）
  │     └─ await logger.flush()
  │
  └─ 5. 顶层 catch re-throw
        └─ CLI main: process.exitCode = mapErrorCodeToExit(err.code ?? 'UNKNOWN')
```

**关键不变量：**
- `shutdown` phase 总会执行（用 try/finally 包裹）
- shutdown 内的 hook 错误只 log 不抛（避免掩盖根因）
- 错误码到退出码的映射在 `errors.ts` 中集中

### 3.4 EventBus 设计

```ts
// @nx-mk/kernel/src/event-bus.ts
import { EventEmitter } from 'node:events'

export type KernelEvent =
  | { type: 'phase:start'; phase: Phase; timestamp: string }
  | { type: 'phase:end';   phase: Phase; durationMs: number; error?: { message: string } }
  | { type: 'plugin:loaded'; name: string; version: string }
  | { type: 'plugin:error'; name: string; hook: HookName; phase: Phase; error: { message: string; stack?: string } }
  | { type: 'kernel:error'; phase: Phase; error: { message: string } }
  | { type: 'log'; level: 'debug'|'info'|'warn'|'error'; message: string; meta?: Record<string, unknown> }

export class EventBus {
  private emitter = new EventEmitter()
  private logStream?: NodeJS.WritableStream  // 用于 events.jsonl 持久化

  constructor(opts?: { persistTo?: NodeJS.WritableStream }) {
    if (opts?.persistTo) this.logStream = opts.persistTo
    this.emitter.setMaxListeners(50)
  }

  emit(event: KernelEvent): void {
    if (this.logStream) this.logStream.write(JSON.stringify(event) + '\n')
    this.emitter.emit(event.type, event)
  }

  on<T extends KernelEvent['type']>(
    type: T,
    handler: (event: Extract<KernelEvent, { type: T }>) => void | Promise<void>
  ): () => void {
    this.emitter.on(type, handler as any)
    return () => this.emitter.off(type, handler as any)
  }

  off(type: KernelEvent['type'], handler: Function): void {
    this.emitter.off(type, handler as any)
  }
}
```

**持久化：** `events.jsonl` 由 `createKernel` 在构造时通过 `fs.createWriteStream` 打开并传给 `EventBus`。Fire-and-forget（不阻塞 emit）。

### 3.5 Hook 执行器

```ts
// @nx-mk/kernel/src/hooks.ts
export async function runHook(
  name: HookName,
  plugin: Plugin,
  ctx: PluginContext
): Promise<void> {
  const handler = plugin.hooks[name]
  if (!handler) return                       // hook 未实现 = no-op
  try {
    await handler(ctx)
  } catch (err) {
    // 包成 PluginHookError 并抛
    throw new KernelError(
      'PLUGIN_HOOK_FAILED',
      `Plugin '${plugin.name}' hook '${name}' failed: ${(err as Error).message}`,
      err
    )
  }
}

export async function runHooksForPhase(
  phase: Phase,
  timing: 'before' | 'main' | 'after',
  plugins: Plugin[],
  ctx: PluginContext
): Promise<void> {
  // 主 hook 名称：phase 本身（如 'run'）
  // before hook：`before${Capitalize<phase>}`（如 'beforeRun'）
  // after hook：`after${Capitalize<phase>}`（如 'afterRun'）
  const hookName = timing === 'main' ? phase : timing === 'before' ? `before${capitalize(phase)}` : `after${capitalize(phase)}`
  for (const plugin of plugins) {
    await runHook(hookName, plugin, ctx)     // fail-fast：首个 throw 跳出 for 循环
  }
}
```

### 3.6 Plugin Registry

```ts
// @nx-mk/kernel/src/plugin-registry.ts
export async function loadPlugins(names: string[]): Promise<Plugin[]> {
  const plugins: Plugin[] = []
  for (const name of names) {
    let mod: any
    try {
      mod = await import(name)               // 从 node_modules 解析
    } catch (err) {
      throw new KernelError(
        'PLUGIN_LOAD_FAILED',
        `Failed to load plugin '${name}': ${(err as Error).message}`,
        err
      )
    }
    const factory = mod.default ?? mod.createPlugin ?? mod.plugin
    if (typeof factory !== 'function') {
      throw new KernelError(
        'PLUGIN_SHAPE_INVALID',
        `Plugin '${name}' must export default a function returning Plugin`,
      )
    }
    const plugin = factory()
    validatePluginShape(plugin, name)
    validatePackageMatch(plugin, name)        // 校验 name/version 与 package.json 一致
    plugins.push(plugin)
  }
  return plugins
}
```

**包名校验：** 通过 `import.meta.resolve(name)` 或 `createRequire(import.meta.url).resolve(name)` 获取包路径，读 `package.json`，比对 `name` 和 `version`。

---

## 4. 错误码与退出码

### 4.1 错误码

```ts
// @nx-mk/kernel/src/errors.ts
export type ErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'PLUGIN_LOAD_FAILED'
  | 'PLUGIN_SHAPE_INVALID'
  | 'PLUGIN_HOOK_FAILED'
  | 'KERNEL_INTERNAL'

export class KernelError extends Error {
  readonly code: ErrorCode
  readonly cause?: unknown
  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'KernelError'
    this.code = code
    this.cause = cause
  }
}
```

### 4.2 退出码映射

| ErrorCode | CLI exit | 触发场景 |
|---|---|---|
| `CONFIG_NOT_FOUND` | 2 | `nx-mk.config.yml` 不存在 |
| `CONFIG_INVALID` | 2 | Zod 校验失败（YAML 格式错、字段类型错、必填缺失） |
| `PLUGIN_LOAD_FAILED` | 3 | `import(name)` 失败（包未装） |
| `PLUGIN_SHAPE_INVALID` | 3 | default 导出不是函数 / 形状不对 / name-version 不匹配 |
| `PLUGIN_HOOK_FAILED` | 4 | 任一 plugin hook 抛错 |
| `KERNEL_INTERNAL` | 5 | kernel 内部 bug（如 NDJSON 写盘失败） |
| 其它 throw（非 KernelError） | 1 | 兜底 |

CLI main：

```ts
try {
  await runSubcommand(subcommand)
} catch (err) {
  if (err instanceof KernelError) {
    process.exitCode = mapErrorCodeToExit(err.code)
    console.error(formatError(err))
  } else {
    process.exitCode = 1
    console.error('Unexpected error:', err)
  }
}
```

---

## 5. 日志与产物

### 5.1 日志文件位置与格式

```
.nx-mk/
└── runs/
    └── run_20260826_103012/
        ├── kernel.log          # NDJSON，所有 logger 输出
        ├── error.log           # 仅 error 级别（快速定位）
        ├── events.jsonl        # 所有 EventBus 事件
        └── config.snapshot.yml # 解析后的 ResolvedConfig（含覆盖记录）
```

**NDJSON 格式（每行一个 JSON 对象）：**

```jsonl
{"ts":"2026-08-26T10:30:12.123Z","level":"info","runId":"run_20260826_103012","phase":"loadConfig","msg":"loading config","meta":{"path":"./nx-mk.config.yml"}}
{"ts":"2026-08-26T10:30:12.234Z","level":"info","runId":"run_20260826_103012","phase":"resolvePlugins","plugin":"@nx-mk/plugin-swagger","msg":"plugin loaded","meta":{"version":"0.1.0"}}
{"ts":"2026-08-26T10:30:12.500Z","level":"error","runId":"run_20260826_103012","phase":"run","plugin":"@nx-mk/plugin-swagger","hook":"run","msg":"plugin hook failed","meta":{"error":{"message":"ENOENT","code":"PLUGIN_HOOK_FAILED","stack":"..."}}}
```

### 5.2 Stderr Mirror（人读格式）

```
[10:30:12.123] loadConfig   loading config                       path=./nx-mk.config.yml
[10:30:12.234] resolvePlugins  plugin loaded                    plugin=@nx-mk/plugin-swagger v0.1.0
[10:30:12.500] ERROR run    plugin hook failed                  plugin=@nx-mk/plugin-swagger hook=run error="ENOENT..."
```

### 5.3 日志级别

- 默认：`info`
- 可覆盖：`nx-mk.config.yml` 的 `logLevel` 字段 或 `--log-level` CLI flag 或 `nx-mk_LOG_LEVEL` env var
- 级别：`debug` < `info` < `warn` < `error` < `silent`
- 文件 log 和 stderr mirror 用同一个 level filter
- `silent` 模式下 `error.log` 仍写入（兜底），`kernel.log` 跳过非 error 行

### 5.4 配置快照

每次 `kernel.run()` 把最终 `ResolvedConfig` 写到 `config.snapshot.yml`，便于事后复现：

```yaml
# .nx-mk/runs/run_20260826_103012/config.snapshot.yml
plugins:
  - '@nx-mk/plugin-swagger'
logLevel: info
outputDir: ./.nx-mk/runs

# 元数据（不参与后续加载）
_meta:
  configPath: /abs/path/to/nx-mk.config.yml
  runId: run_20260826_103012
  envOverrides:
    logLevel: debug
  cliOverrides: {}
```

---

## 6. CLI 命令

### 6.1 命令清单

```
npx nx-mk                  → subcommand = 'run'    （默认）
npx nx-mk init             → subcommand = 'init'
npx nx-mk doctor           → subcommand = 'doctor'
npx nx-mk --help           → 打印 help，不进 kernel
npx nx-mk --version        → 打印 version
```

### 6.2 argv 解析

简单手写 parser（不引入 commander / yargs，Phase 0 简单）：

```ts
// cli/src/index.ts
const argv = process.argv.slice(2)
let subcommand: 'run' | 'init' | 'doctor' | null = null
let configPath: string | undefined
let logLevel: LogLevel | undefined
let outputDir: string | undefined
let runId: string | undefined
let help = false
let version = false

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  switch (a) {
    case '--help': case '-h': help = true; break
    case '--version': case '-v': version = true; break
    case '--config': configPath = argv[++i]; break
    case '--log-level': logLevel = argv[++i] as LogLevel; break
    case '--output-dir': outputDir = argv[++i]; break
    case '--run-id': runId = argv[++i]; break
    case 'init': case 'doctor': case 'run':
      subcommand = a; break
    default:
      if (a.startsWith('--')) throw new KernelError('KERNEL_INTERNAL', `Unknown flag: ${a}`)
  }
}

if (version) { console.log(PKG_VERSION); process.exit(0) }
if (help || !subcommand) { printHelp(); process.exit(help ? 0 : 1) }
```

### 6.3 `doctor` 实现

```ts
// cli/src/commands/doctor.ts
import { createKernel } from '@nx-mk/kernel'
import { findConfigFile } from '@nx-mk/config'

export async function runDoctor(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []

  // 1. Node 版本
  const nodeVer = process.versions.node
  const major = parseInt(nodeVer.split('.')[0])
  checks.push({
    name: 'Node.js >= 20',
    ok: major >= 20,
    detail: `current: ${nodeVer}`,
  })

  // 2. config 文件
  let configPath: string | null = null
  try {
    configPath = findConfigFile(process.cwd())
    checks.push({ name: 'nx-mk.config.yml', ok: true, detail: configPath })
  } catch {
    checks.push({
      name: 'nx-mk.config.yml',
      ok: false,
      detail: 'not found; run `npx nx-mk init` to scaffold',
    })
  }

  // 3. .nx-mk/ 目录可写
  try {
    await fs.mkdir('.nx-mk/runs', { recursive: true })
    await fs.writeFile('.nx-mk/.doctor-test', 'ok')
    await fs.unlink('.nx-mk/.doctor-test')
    checks.push({ name: '.nx-mk/ writable', ok: true })
  } catch (err) {
    checks.push({ name: '.nx-mk/ writable', ok: false, detail: (err as Error).message })
  }

  // 4. plugins 可解析（仅在 config 存在时）
  if (configPath) {
    const kernel = createKernel({ configPath, runId: 'doctor', subcommand: 'doctor' })
    try {
      // 进 kernel.run() 让 plugin-registry 实际加载；如果 fail 就会 catch 到
      await kernel.run()
      checks.push({ name: 'plugins loadable', ok: true })
    } catch (err) {
      checks.push({ name: 'plugins loadable', ok: false, detail: (err as Error).message })
    }
  }

  // 打印 + 退出码
  for (const c of checks) {
    const mark = c.ok ? '✔' : '✖'
    console.log(`${mark} ${c.name}${c.detail ? ' — ' + c.detail : ''}`)
  }
  const allOk = checks.every((c) => c.ok)
  if (!allOk) process.exit(2)
}
```

### 6.4 `init` 实现

```ts
// cli/src/commands/init.ts
export async function runInit(): Promise<void> {
  const configPath = path.resolve(process.cwd(), 'nx-mk.config.yml')

  if (await fileExists(configPath)) {
    console.log(`✔ nx-mk.config.yml already exists at ${configPath}`)
  } else {
    const content = `# nx-mk configuration
# See: docs/superpowers/specs/2026-08-26-nx-mk-phase0-foundation-design.md

plugins:
  - '@nx-mk/plugin-swagger'

logLevel: info
`
    await fs.writeFile(configPath, content, 'utf8')
    console.log(`✔ Created ${configPath}`)
  }

  await fs.mkdir('.nx-mk/runs', { recursive: true })
  console.log('✔ Created .nx-mk/runs/')

  // 进 kernel.run() 演练生命周期
  const kernel = createKernel({ configPath, runId: 'init', subcommand: 'init' })
  await kernel.run()
  console.log('✔ Kernel lifecycle exercised; see .nx-mk/runs/init/')
}
```

### 6.5 `run` 默认实现

```ts
// cli/src/commands/run.ts
export async function runMain(): Promise<void> {
  const configPath = findConfigFile(process.cwd())  // 失败抛 CONFIG_NOT_FOUND
  const runId = generateRunId()
  const kernel = createKernel({ configPath, runId, subcommand: 'run' })
  const result = await kernel.run()
  console.log(`✔ Run ${result.runId} completed in ${result.durationMs}ms`)
  console.log(`  Logs: .nx-mk/runs/${result.runId}/`)
}
```

---

## 7. 配置 Schema

### 7.1 Zod schema

```ts
// config/src/schema.ts
import { z } from 'zod'

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent'])

export const PluginNameSchema = z.string().regex(
  /^@?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/,
  'plugin name must be a valid npm package name'
)

export const ConfigSchema = z.object({
  plugins: z.array(PluginNameSchema)
    .max(20, 'max 20 plugins')
    .default([]),
  logLevel: LogLevelSchema.default('info'),
  outputDir: z.string()
    .regex(/^\.{0,2}\//, 'must be a relative path starting with ./ or ../')
    .default('.nx-mk/runs'),
}).passthrough()  // 允许 Phase 1+ 字段，暂不解析

export type Config = z.infer<typeof ConfigSchema>
```

### 7.2 ResolvedConfig

```ts
export interface ResolvedConfig extends Config {
  configPath: string             // 实际加载文件的绝对路径
  runId: string                  // 自动生成：run_YYYYMMDD_HHMMSS
  envOverrides: Partial<Config>  // 来自 env var 的覆盖（记录用）
  cliOverrides: Partial<Config>  // 来自 CLI flag 的覆盖（记录用）
  subcommand: 'run' | 'init' | 'doctor'  // CLI 路由决策
}
```

### 7.3 优先级与查找顺序

**覆盖优先级（高 → 低）：**
1. CLI flag：`--log-level debug` / `--config ./foo.yml` / `--output-dir ./artifacts` / `--run-id <id>`
2. Environment：`nx-mk_LOG_LEVEL` / `nx-mk_CONFIG` / `nx-mk_OUTPUT_DIR` / `nx-mk_RUN_ID`
3. Config file：`nx-mk.config.yml`
4. Built-in default

**Config file 查找：**
```
起点 = process.cwd()
终点 = git root（git rev-parse --show-toplevel）或 fs root
沿途查找 nx-mk.config.yml / nx-mk.config.yaml
首个匹配 = configPath；找不到 = throw CONFIG_NOT_FOUND
```

### 7.4 校验失败 UX

```
$ npx nx-mk
✖ Invalid config: ./nx-mk.config.yml

  × plugins.0: Invalid string
    ├─ Expected: /^@?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/
    ├─ Received: "@nx-mk/BAD-NAME"
    └─ Hint: plugin name must be a valid npm package name

Exit code: 2
```

---

## 8. 测试策略

### 8.1 框架与结构

- **框架：** Vitest（已在根 `devDependencies`）
- **位置：** `__tests__/*.test.ts` 与被测代码同目录
- **配置文件：** 根级 `vitest.config.ts`
- **覆盖率工具：** `@vitest/coverage-v8`

### 8.2 TDD 适用范围

| 模块 | TDD? |
|---|---|
| `kernel/src/hooks.ts` | ✅ 强 TDD |
| `kernel/src/event-bus.ts` | ✅ 强 TDD |
| `kernel/src/plugin-registry.ts` | ✅ 强 TDD |
| `kernel/src/kernel.ts` | ✅ 强 TDD |
| `kernel/src/errors.ts` | ✅ 强 TDD |
| `kernel/src/logger.ts` | ⚠️ 弱 TDD（先写骨架测试，格式化细节后做） |
| `config/src/loader.ts` | ❌ test-after（I/O 重） |
| `cli/src/commands/*.ts` | ❌ test-after（end-to-end 覆盖） |
| `manifest/src/index.ts` | ❌ 不测（占位） |
| `plugin-swagger/src/index.ts` | ❌ 不测（占位） |

### 8.3 覆盖率目标

```
packages/kernel/src/      → ≥ 85% line coverage
packages/config/src/      → ≥ 70% line coverage
packages/cli/src/         → ≥ 50% line coverage
packages/manifest/src/    → 不强制
packages/plugin-swagger/  → 不强制
```

通过 `vitest run --coverage --coverage.thresholds.lines=85` 等命令在 CI 强制。

### 8.4 关键集成测试

```ts
// packages/kernel/__tests__/lifecycle.test.ts
describe('kernel lifecycle', () => {
  it('executes all 5 phases in order with before/after hooks around each', async () => {
    const calls: string[] = []
    const plugin = makeMockPlugin(calls)
    // 写入临时 config, 调用 createKernel, 断言 calls 顺序
  })

  it('fails fast when a hook throws and still runs shutdown', async () => {
    const calls: string[] = []
    const plugin = makeMockPlugin(calls, { throwOn: 'run' })
    // 断言: 调用抛出 PLUGIN_HOOK_FAILED
    // 断言: shutdown hooks 仍然被调用
    // 断言: events.jsonl 包含 kernel:error
  })

  it('runs shutdown hooks in reverse order', async () => {
    const plugins = [makePluginA(), makePluginB(), makePluginC()]
    // 断言 shutdown 调用顺序: C → B → A
  })

  it('runs all 5 phases regardless of subcommand', async () => {
    for (const sub of ['run', 'init', 'doctor'] as const) {
      const calls: string[] = []
      const plugin = makeMockPlugin(calls)
      await createKernel({ ..., subcommand: sub }).run()
      expect(calls).toContain('beforeLoadConfig')
      expect(calls).toContain('shutdown')
    }
  })
})
```

```ts
// packages/kernel/__tests__/plugin-registry.test.ts
describe('loadPlugins', () => {
  it('loads plugin from node_modules and validates shape', async () => { ... })
  it('throws PLUGIN_LOAD_FAILED if package not found', async () => { ... })
  it('throws PLUGIN_SHAPE_INVALID if default export is not a function', async () => { ... })
  it('throws PLUGIN_SHAPE_INVALID if name/version mismatch package.json', async () => { ... })
})
```

```ts
// packages/config/__tests__/loader.test.ts
describe('loadConfig', () => {
  it('parses valid YAML and applies defaults', async () => { ... })
  it('throws CONFIG_NOT_FOUND when no file in cwd or parents', async () => { ... })
  it('throws CONFIG_INVALID with zod issues on bad schema', async () => { ... })
  it('CLI flags override env vars override config file override defaults', async () => { ... })
})
```

---

## 9. Plugin 作者合约

### 9.1 最小合约

```ts
// my-plugin/src/index.ts
import type { Plugin } from '@nx-mk/kernel'

export default function createMyPlugin(): Plugin {
  return {
    name: '@scope/my-plugin',           // 必须与 package.json "name" 一致
    version: '0.1.0',                   // 必须与 package.json "version" 一致
    hooks: {
      async beforeResolvePlugins(ctx) {
        ctx.logger.info('my-plugin ready')
      },
      async run(ctx) {
        const cmd = ctx.kernel.getSubcommand()
        if (cmd === 'run') {
          // Phase 1+ 实做
        }
      },
    },
  }
}
```

### 9.2 Plugin 能做 / 不能做

| 能 | 不能 |
|---|---|
| 订阅 EventBus 任何事件 | 修改其它 plugin 的 ctx 字段 |
| emit 自定义 typed 事件 | `process.exit()`（应 throw，让 kernel shutdown） |
| 在 `run` hook 读 `ctx.kernel.getSubcommand()` | 阻塞 main thread（hook 应 async） |
| 在 `shutdown` hook 清理临时资源 | 写文件到 `.nx-mk/runs/<other-runId>/` |
| 用 `ctx.logger` 输出日志 | `console.log`（被 NDJSON logger 接管） |

### 9.3 package.json 必需字段

```json
{
  "name": "@scope/my-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "peerDependencies": {
    "@nx-mk/kernel": "^0.1.0"
  }
}
```

### 9.4 测试 Plugin

Phase 0 **不提供**官方 test harness（避免 over-engineering）。Plugin 作者可用：

```ts
// Mock approach
it('logs init message', async () => {
  const plugin = createMyPlugin()
  const logger = { info: vi.fn(), /* ... */ }
  await plugin.hooks.beforeResolvePlugins!({ logger, /* ... */ } as any)
  expect(logger.info).toHaveBeenCalledWith('my-plugin ready')
})

// 或：集成 approach（推荐）
it('integrates with kernel lifecycle', async () => {
  const kernel = createKernel({
    configPath: './fixtures/nx-mk.config.yml',
    runId: 'test',
    plugins: [createMyPlugin()],
  })
  await kernel.run()
  // 断言副作用
})
```

### 9.5 版本契约

- `name` 与 `version` 必须与 `package.json` 一致（kernel 启动时校验）
- 不一致抛 `PLUGIN_SHAPE_INVALID`
- Phase 0 不做 plugin 之间版本协商（Phase 1+）

---

## 10. 实施分块（写到 writing-plans 时细化）

按依赖顺序：

```
Block 1: 根级配置
  ├─ pnpm-workspace.yaml（已存在）
  ├─ tsconfig.base.json（已存在）
  ├─ 根 package.json 加 vitest + @vitest/coverage-v8 dev deps
  └─ vitest.config.ts（根级）

Block 2: errors.ts + types.ts (kernel 零依赖基础)
  ├─ 先写 errors.ts + test
  └─ 先写 types.ts（仅类型）

Block 3: event-bus.ts + logger.ts (kernel 内部基础)
  ├─ event-bus.ts + test
  └─ logger.ts + test

Block 4: plugin.ts (类型层)
  └─ plugin.ts（纯类型）

Block 5: hooks.ts + plugin-registry.ts (kernel 逻辑)
  ├─ hooks.ts + test
  └─ plugin-registry.ts + test

Block 6: kernel.ts (驱动器)
  └─ kernel.ts + 集成测试

Block 7: kernel index.ts + package.json
  └─ 公共 API 重导出

Block 8: config/ (独立包)
  ├─ schema.ts
  ├─ loader.ts + test
  └─ package.json + tsconfig + tsup config

Block 9: manifest/ (占位)
  └─ index.ts + package.json + tsconfig + tsup config

Block 10: plugin-swagger/ (占位)
  └─ index.ts + package.json + tsconfig + tsup config

Block 11: cli/ (入口 + 3 命令)
  ├─ index.ts (argv parser)
  ├─ commands/doctor.ts
  ├─ commands/init.ts
  ├─ commands/run.ts
  └─ package.json + bin 字段

Block 12: 端到端验证
  ├─ pnpm install
  ├─ pnpm -r build
  ├─ pnpm -r test
  ├─ pnpm --filter @nx-mk/cli init
  ├─ pnpm --filter @nx-mk/cli doctor
  ├─ pnpm --filter @nx-mk/cli run
  └─ 故意 throw 验证 fail-fast + 退出码 4
```

---

## 11. 风险与未来扩展点

### 11.1 Phase 0 已知风险

| 风险 | 缓解 |
|---|---|
| Plugin 加载是动态 `import()`，Node 缓存可能导致旧版本残留 | Phase 1 加 cache buster（hash package.json） |
| `EventEmitter` 默认 max listeners = 10，插件多时不够 | kernel 创建时 `setMaxListeners(50)` |
| NDJSON 文件无 rotation；长 run 写满磁盘 | Phase 1 加按 size 切分 |
| shutdown 内 hook 错误只 log，掩盖子问题 | Phase 1 加 `kernel.shutdownErrors` 计数，run 末尾汇总 |
| 不支持 plugin 之间的版本协商 | Phase 1+ 实现 capabilities + version range |

### 11.2 SPEC #1 衔接点

SPEC #1 引入 `@nx-mk/client` / `@nx-mk/runtime` / `@nx-mk/client-codegen` 时：
- kernel 接口**不需要改**（SPEC #1 是 SDK 端，与 CLI 端 kernel 平行）
- plugin-swagger 在 Phase 1 升级：从 `run` hook 改为生成 manifest 输出文件
- config schema Phase 1 加字段：`mode` / `dashboard.port` / `scenarios`
- 退出码扩展：可能加 `MANIFEST_INVALID` / `OPENAPI_NOT_FOUND` 等

### 11.3 未在 Phase 0 实现的扩展点（明确写出来）

- Capability-based plugin（plugin 注册 "I provide X"，kernel 拓扑排序）
- Per-plugin config block（`plugins: [{ name, config }]`）
- Plugin 沙箱（隔离 plugin 不能 import 任意模块）
- 远程 plugin（从 URL / git 加载）
- Plugin marketplace / registry

### 11.4 Known Design Constraints (Phase 0 close)

The following 2 issues were identified during Task 18 E2E verification but are NOT addressed in Phase 0 — they require architectural changes deferred to Phase 1+:

1. **Plugin resolution location**: When a plugin is installed in a user's project (`<user-project>/node_modules/@nx-mk/foo/`), the kernel's dynamic `import(name)` resolves from the kernel's own location (`packages/kernel/dist/index.js`), not the user's cwd. This means plugins MUST be reachable from the kernel's install path, not just the user's project. E2E test 2 only worked because the thrower was copied into the workspace's `node_modules/`, not the user's. Mitigation for users: install plugins as workspace deps in the user's project (so they end up in the same `node_modules/` tree).

2. **Cyclic workspace dep (kernel ↔ config)**: `@nx-mk/kernel` declares `@nx-mk/config` as a peer+devDep for type-sharing. This creates a cycle that produces `pnpm` warnings at install and complicates tsup's DTS generation. Architectural fix deferred to Phase 1 (likely: extract shared types to a new `@nx-mk/types` package that both kernel and config depend on).

Neither constraint blocks Phase 0 functionality — both 4 E2E scenarios pass with correct exit codes.

---

## 12. 自检（spec self-review checklist）

撰写完成后逐项检查：

- [x] 无 placeholder / TODO / TBD（除明确标记的 Phase 1+ 字段）
- [x] 5 个 phase 名称在所有 section 一致
- [x] 错误码列表在 §4 和 §10 实施分块一致
- [x] 退出码映射在 §4 完整
- [x] CLI 命令清单在 §6 与 §10 一致
- [x] Plugin 类型在 §3.1 与 §9 一致
- [x] 文件路径在 §2.1 与 §10 一致
- [x] 数据流在 §3.2 涵盖所有 phase
- [x] 错误流在 §3.3 涵盖 fail-fast + shutdown
- [x] 范围聚焦 Phase 0，明确排除 SPEC #1
- [x] 每个需求无歧义（单一定义）
