# mk Spec #1: Foundation + SDK Facade 闭环

> 日期：2026-08-26
> 范围：Phase 0–3（项目骨架 + Manifest + Runtime 采集 + Coverage 分析）+ SDK Facade 架构
> 不在范围：Dashboard UI（Spec #2）、Agent / Loop（Spec #3）、CI 模式（暂不实施）
> 关联文档：`docx/plan/mk-plan.md`（原始方案）、`docx/plan/mk-plan-questions.md`（决策记录）

---

## 1. 目标与非目标

### 1.1 目标

本 spec 交付后，用户可执行：

```bash
# 在已有 React + Vite 项目中
pnpm add -D @mk/client
# 改一行 import：fetch -> api.user.getUser()
npx mk
```

完成一次端到端运行：解析 OpenAPI → 生成 Manifest → 注入 SDK Facade → 启动 app + Playwright → 跑 scenarios → 采集 request/response/field-hit/UI-evidence → 计算 coverage → 写入 SQLite + report.json → 启动最小可用的 dashboard server（API 完整，UI 简化）。

### 1.2 非目标（明确不在本 spec）

- Dashboard UI 完整实现（Spec #2）
- Agent 任何能力（Spec #3）
- Replay 写入能力（Spec #2）
- Anti-cheat 完整实现（Spec #2）
- CI 模式（用户决策 E：暂不实施）
- 多框架支持（仅 React + Vite）
- 多进程 scenario 并发（SPEC #1 仅做串行，并发改到 Spec #2）
- 完整的 Privacy / Masking UI（默认实现 + Spec #2 完善）

### 1.3 成功标准

- `npx mk` 在干净项目（仅装 `@mk/client` + 配 `mk.config.yml`）上可跑通完整链路
- 至少覆盖一个 demo app：`examples/react-vite-demo` 含真实后端 + OpenAPI 输出
- Coverage 三层指标（required / effective / rawBackend）正确计算
- Returned but ignored、missing required、suspicious 三类字段全部出现在 report
- SDK Facade 在 production build 中 ≤ 3KB（gzip 后）
- SDK Facade 在 analysis build 中正确启用 tracked proxy + collector

---

## 2. 架构总览

### 2.1 三层结构

```
┌─────────────────────────────────────────────────────────┐
│  用户应用（React + Vite）                               │
│  ┌──────────────────────────────────────────────┐       │
│  │ 业务代码                                     │       │
│  │ const user = await api.user.getUser(id)      │       │
│  └───────────────┬──────────────────────────────┘       │
│                  │ import { api } from '@mk/client'     │
│  ┌───────────────▼──────────────────────────────┐       │
│  │ @mk/client（SDK Facade）                      │       │
│  │ - 生产：薄壳 fetch 包装（~1-3KB）             │       │
│  │ - 分析：fetch → manifest bind → proxy → collect│       │
│  └───────────────┬──────────────────────────────┘       │
└──────────────────┼──────────────────────────────────────┘
                   │ fetch + tracked metadata
                   ▼
┌─────────────────────────────────────────────────────────┐
│  mk CLI（npx mk 启动）                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Manifest │ │ Coverage │ │Scenario  │ │ Dashboard│    │
│  │ Generator│ │ Analyzer │ │ Runner   │ │ Server   │    │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘    │
│       └────────────┴────────────┴────────────┘          │
│                  │ Kernel Event Bus                     │
└──────────────────┼──────────────────────────────────────┘
                   │
                   ▼
        .mk/runs/{runId}/
          ├── manifest.json
          ├── coverage.db
          ├── report.json
          └── artifacts/
```

### 2.2 三个运行模式

| 模式 | 触发 | SDK 行为 | mk 进程 |
|---|---|---|---|
| `production` | 用户 `vite build` | 薄壳 fetch 包装 | 不启动 |
| `analysis` | `npx mk` | tracked proxy + collector | 启动 |
| `development` | 用户 `vite dev`（默认） | 薄壳（同 production） | 不启动 |
| `test` | 用户跑测试 | 同 development | 不启动 |

注：`analysis` 是 mk 独占模式；其他三个模式 SDK 都是薄壳。

---

## 3. SDK Facade 架构（核心）

### 3.1 接入路径

```ts
// package.json（用户项目）
{
  "devDependencies": {
    "@mk/client": "^0.1.0",
    "@mk/runtime": "^0.1.0"  // analysis 模式专用，可选
  }
}

// 业务代码
import { api } from '@mk/client'

// Before
const res = await fetch('/api/users/1')
const user = await res.json()

// After
const user = await api.users.getUser(1)
```

### 3.2 包结构

```
packages/
├── client/              # @mk/client：通用 SDK 入口
│   ├── src/
│   │   ├── index.ts           # export { api }
│   │   ├── facade.ts          # proxy-based facade 生成器
│   │   ├── runtime-mode.ts    # 检测当前模式
│   │   └── transport.ts       # fetch wrapper
│   └── package.json
│
├── client-codegen/      # @mk/client-codegen：OpenAPI → SDK 类型生成
│   ├── src/
│   │   ├── generate.ts        # OpenAPI → .d.ts + .js
│   │   └── template/          # 模板文件
│   └── package.json
│
└── runtime/             # @mk/runtime：analysis 模式专用
    ├── src/
    │   ├── production.ts      # 薄壳实现（默认入口）
    │   ├── analysis.ts        # tracked proxy + collector
    │   └── field-proxy.ts     # 字段级 Proxy 实现
    └── package.json
```

### 3.3 运行时模式切换机制

```ts
// @mk/client/src/runtime-mode.ts
export type RuntimeMode = 'production' | 'development' | 'analysis' | 'test'

export function detectMode(): RuntimeMode {
  // 1. 显式环境变量（最高优先级）
  if (typeof process !== 'undefined' && process.env?.MK_MODE) {
    return process.env.MK_MODE as RuntimeMode
  }
  // 2. Vite define 注入
  if (typeof __MK_MODE__ !== 'undefined') {
    return __MK_MODE__
  }
  // 3. 默认 production
  return 'production'
}

// 动态 import 对应实现
export async function loadRuntime(mode: RuntimeMode) {
  if (mode === 'analysis') {
    return import('@mk/runtime/analysis')
  }
  return import('@mk/runtime/production')
}
```

### 3.4 Production 模式实现（薄壳）

```ts
// @mk/runtime/src/production.ts
// 这是 SDK 在用户 prod bundle 里的存在形式
export function createApiClient(baseURL: string) {
  return {
    request: async (method: string, path: string, opts: any) => {
      const url = baseURL + path
      const res = await fetch(url, {
        method,
        headers: opts.headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      })
      if (!res.ok) throw new Error(`${method} ${path} ${res.status}`)
      return res.json()
    },
  }
}
```

预计体积：~500 字节 minified，~300 字节 gzipped。

### 3.5 Analysis 模式实现（完整追踪）

```ts
// @mk/runtime/src/analysis.ts
import { createTrackedProxy } from './field-proxy'
import { Collector } from './collector'

export function createApiClient(baseURL: string, manifest: ApiManifest) {
  const collector = new Collector()
  const request = async (method: string, path: string, opts: any) => {
    const requestId = generateRequestId()
    const endpoint = manifest.matchEndpoint(method, path)
    
    collector.recordRequestStart({
      requestId,
      endpointId: endpoint?.id,
      method, url: baseURL + path,
      body: opts.body,
    })
    
    try {
      const res = await fetch(baseURL + path, { ... })
      const data = await res.json()
      
      collector.recordRequestEnd({
        requestId,
        status: res.status,
        body: data,
      })
      
      // 用 tracked proxy 包裹响应数据
      return createTrackedProxy(data, {
        requestId,
        endpointId: endpoint?.id,
        collector,
        basePath: 'data',
      })
    } catch (err) {
      collector.recordRequestError({ requestId, error: err })
      throw err
    }
  }
  
  return { request, collector }  // collector 暴露给测试断言
}
```

### 3.6 SDK 代码生成（OpenAPI → Facade）

`npx mk` 启动时执行：

```
1. 解析 OpenAPI（用户项目里的 swagger.json / openapi.yaml）
2. 生成 Manifest（详见 §6）
3. 基于 Manifest 生成 .mk/sdk/{endpoint}.ts
   - 用户 import { api } from '@mk/client'
   - @mk/client 内部读 .mk/sdk/index.ts（生成产物）
4. 注入 analysis env 到用户 app
5. 启动 app + 跑 scenarios
```

生成的 SDK 类型示例：

```ts
// .mk/sdk/users.ts（生成产物，不进 git）
export const usersFacade = {
  getUser: (id: number): Promise<User> => 
    request('GET', `/api/users/${id}`),
  listUsers: (opts?: { limit?: number }): Promise<User[]> => 
    request('GET', '/api/users', { query: opts }),
}

// .mk/sdk/index.ts
export { usersFacade as users } from './users'
export { ordersFacade as orders } from './orders'
```

### 3.7 字段级 Proxy 设计

```ts
// @mk/runtime/src/field-proxy.ts
export function createTrackedProxy<T extends object>(
  target: T,
  ctx: { requestId: string; endpointId: string; collector: Collector; basePath: string }
): T {
  // 跳过非 plain object
  if (!shouldProxy(target)) return target
  
  const cache = proxyCache.get(target)
  if (cache) return cache as T
  
  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(obj, prop, receiver)
      
      const value = Reflect.get(obj, prop, receiver)
      const fieldPath = normalizePath(`${ctx.basePath}.${String(prop)}`)
      
      ctx.collector.recordFieldHit({
        requestId: ctx.requestId,
        endpointId: ctx.endpointId,
        fieldPath,
        normalizedPath: fieldPath,
        timestamp: Date.now(),
      })
      
      // 递归代理嵌套对象
      if (shouldProxy(value)) {
        return createTrackedProxy(value, { ...ctx, basePath: fieldPath })
      }
      return value
    },
  })
  
  proxyCache.set(target, proxy)
  return proxy
}

function shouldProxy(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value !== 'object') return false
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null  // 仅 plain object
}
```

---

## 4. Monorepo 结构（Phase 0）

```
mk/
├── package.json                  # pnpm workspace 根
├── pnpm-workspace.yaml
├── turbo.json                    # 任务编排
├── tsconfig.base.json
├── .gitignore
│
├── packages/
│   ├── cli/                      # npx mk 命令
│   ├── kernel/                   # 插件内核 + Event Bus
│   ├── config/                   # 配置 schema + loader
│   ├── manifest/                 # OpenAPI → Manifest
│   ├── client/                   # @mk/client（生产薄壳）
│   ├── client-codegen/           # OpenAPI → SDK 代码生成
│   ├── runtime/                  # @mk/runtime（analysis 实现）
│   ├── coverage/                 # Policy + Analyzer + Trace
│   ├── scenario/                 # DSL + Playwright runner
│   ├── dashboard-server/         # Fastify + API（API 完整，UI 简化版）
│   ├── agent-sdk/                # 占位（Spec #3）
│   └── plugin-swagger/           # OpenAPI 适配插件
│
├── examples/
│   └── react-vite-demo/          # demo app（含后端）
│
├── docs/
│   └── superpowers/
│       ├── specs/                # 本文档所在
│       └── plans/                # implementation plans
│
└── tools/
    └── scripts/                  # build, release, etc.
```

### 4.1 包依赖关系

```
cli → kernel → config, manifest, runtime, coverage, scenario, dashboard-server
                     ↓              ↓                ↓
                  plugin-swagger  client-codegen    client
                                      ↓
                                  manifest
runtime → client (peer)
client-codegen → manifest
coverage → manifest, runtime
dashboard-server → coverage, manifest
plugin-swagger → manifest
```

### 4.2 不在本 spec 的包

- `agent-sdk/` — 占位，仅创建空目录
- `agent-provider-*/` — 不创建
- `dashboard-ui/` — 不创建（Spec #2）

---

## 5. CLI 设计

### 5.1 主命令

```bash
npx mk               # 默认：init + dashboard + run
npx mk start         # 同上
npx mk init          # 仅生成 mk.config.yml + .mk/
npx mk run           # 仅跑分析（不启动 dashboard）
npx mk report        # 启动 dashboard 服务（指向最新 run）
npx mk doctor        # 环境检查
```

### 5.2 不在本 spec

- `npx mk replay` — Spec #2
- `npx mk loop` — Spec #3
- `npx mk ci` — 暂不实施

### 5.3 Auto-init 行为

首次 `npx mk`（无 `mk.config.yml`）：

1. 检测项目类型（package.json dependencies）
2. 检测 OpenAPI 位置（`./swagger.json`、`./openapi.yaml`、后端路径约定）
3. 生成 `mk.config.yml`（默认值 + 用户字段）
4. 生成 `.mk/` 目录
5. 启动 dashboard
6. 跑分析
7. 打开浏览器（如果 dashboard.open: true）

### 5.4 进度展示

实时终端输出：

```
mk v0.1.0
Dashboard: http://localhost:4317
Current Run: run_20260826_103012

Pipeline
✔ Load config
✔ Resolve plugins
✔ Generate manifest        128 endpoints / 1,246 fields
✔ Generate SDK             128 endpoints typed
✔ Start dashboard          http://localhost:4317
✔ Start app                http://localhost:5173
⠋ Execute scenarios        3/12 running
  ├─ user-profile          ✔ 5 requests
  ├─ order-list            ⠋ capturing
  └─ checkout-flow         pending

Live Metrics
Requests captured: 27
Fields returned:   412
Field hits:        189
```

实现：ora + log-update（SSE 数据驱动）。

---

## 6. OpenAPI Manifest

### 6.1 解析流程

```
swagger.json / openapi.yaml
  │
  ▼
@apidevtools/swagger-parser  → 解析 + 校验 + dereference
  │
  ▼
normalize-openapi            → 统一 schema（OpenAPI 3.x）
  │
  ▼
schema-flatten               → 展开 allOf/oneOf/anyOf
  │
  ▼
endpoint-extract             → 提取所有 endpoint
  │
  ▼
field-extract                → 为每个 endpoint 生成字段列表
  │
  ▼
field-id                     → 稳定 ID 生成（hash）
  │
  ▼
manifest.json                → 输出
```

### 6.2 Manifest Schema

```ts
type ApiManifest = {
  version: '1.0.0'
  source: {
    type: 'openapi'
    input: string  // 原始路径
    hash: string   // 内容 hash，用于检测变化
  }
  generatedAt: string  // ISO timestamp
  endpoints: ApiEndpoint[]
  schemas: Record<string, ApiSchema>
  fields: ApiField[]
}
```

### 6.3 Field ID 规范

```
{method}:{path}:{direction}:{status}:{normalizedFieldPath}
例：GET:/users/{id}:response:200:data.avatarUrl
```

`stableHash(...)` 用 SHA-256 截断前 12 位。

### 6.4 路径归一化

数组路径统一为 `[]`：

```
orders.0.items.2.skuName  →  orders[].items[].skuName
```

避免字段数量爆炸。

### 6.5 运行时校验漂移（决策 B1）

Manifest 写入 SQLite 后，运行时收集真实响应，写入 `_manifest_overrides`：

```sql
CREATE TABLE manifest_overrides (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  actual_type TEXT,
  actual_value_state TEXT,  -- present | null | absent
  sample_value_hash TEXT,
  sample_count INTEGER,
  first_seen_at TEXT,
  last_seen_at TEXT,
  override_type TEXT  -- type_mismatch | extra_field | missing_field
);
```

Dashboard 显示 override 列表，用户可选择写回 OpenAPI（Y/N）。

---

## 7. 配置 Schema

`mk.config.yml` 完整 schema：

```yaml
version: 1

project:
  name: string
  framework: react | vue | svelte   # MVP 仅 react
  bundler: vite | webpack | next    # MVP 仅 vite

openapi:
  input: string                     # 相对项目根
  watch: boolean                    # 默认 true（analysis 模式下）

app:
  command: string                   # 启动 dev server 的命令
  url: string                       # dev server URL
  analysisEnv: Record<string, string>  # 注入到 app 进程的环境

runtime:
  mode: analysis | production | development
  instrumentation:
    proxy: boolean                  # 默认 true
    uiEvidence: boolean             # 默认 true
    collectStack: 'off' | 'sampled' | 'full'
    stackSampleRate: number

coveragePolicy:
  required: Array<{ pattern: string; reason?: string }>
  optional: Array<{ pattern: string; reason?: string }>
  ignored: Array<{ pattern: string; reason?: string }>

privacy:
  responseValues:
    mode: masked | raw | none       # 默认 masked
  mask: Array<{ pattern: string; strategy: email | phone | token | full | partial }>

scenarios:
  include: Array<string>            # glob 模式
  concurrency: number               # 默认 1（本 spec 串行，Spec #2 改 3）

dashboard:
  port: number                      # 默认 4317
  open: boolean                     # 默认 true
  defaultView: latest | history     # 默认 latest

runtimeRetainRuns: number           # 默认 10

# 不在本 spec
agent:    # 留位，Spec #3 启用
ci:       # 留位，暂不实施
```

---

## 8. Kernel + 插件系统

### 8.1 核心接口

```ts
// packages/kernel/src/types.ts
export type RuntimeMode = 'production' | 'development' | 'analysis' | 'test' | 'ci'

export interface KernelPlugin {
  name: string
  version: string
  description?: string
  modes?: RuntimeMode[]
  configSchema?: ZodSchema
  defaultConfig?: unknown
  setup(ctx: KernelContext): Promise<void> | void
  teardown?(): Promise<void> | void
}

export interface KernelContext {
  mode: RuntimeMode
  config: ResolvedConfig
  runId: string
  hooks: KernelHooks
  bus: EventBus
  storage: StorageProvider  // SQLite 访问封装
  logger: Logger
}
```

### 8.2 Hook 系统

```ts
export interface KernelHooks {
  onBootstrap: AsyncSeriesHook<[BootstrapContext]>
  onConfigResolved: AsyncSeriesHook<[ResolvedConfig]>
  onManifestGenerated: AsyncSeriesHook<[ApiManifest]>
  onSdkGenerated: AsyncSeriesHook<[GeneratedSdk]>
  onDashboardStarted: AsyncSeriesHook<[DashboardInfo]>
  onAppStarted: AsyncSeriesHook<[AppInfo]>
  onScenarioStarted: AsyncSeriesHook<[ScenarioContext]>
  onRequestCaptured: AsyncSeriesHook<[RequestTrace]>
  onFieldHit: AsyncSeriesHook<[FieldHitEvent]>
  onUiEvidenceCaptured: AsyncSeriesHook<[UiEvidence]>
  onCoverageAnalyzed: AsyncSeriesHook<[CoverageReport]>
  onRunCompleted: AsyncSeriesHook<[RunResult]>
  onRunFailed: AsyncSeriesHook<[RunError]>
}
```

轻量自研 Hook（不依赖 tapable），减少包体积。

### 8.3 内置插件

| 插件 | 职责 | spec |
|---|---|---|
| `plugin-swagger` | OpenAPI 解析 + Manifest 生成 | #1 |
| `plugin-coverage` | Coverage 计算 + Policy 引擎 | #1 |
| `plugin-sdk` | SDK 代码生成 | #1 |
| `plugin-scenario` | DSL 解析 + Playwright runner | #1 |
| `plugin-dashboard` | Dashboard server 启动 + SSE | #1（API 完整，UI 简化） |
| `plugin-agent` | Agent 编排 | #3 |
| `plugin-ci` | CI 模式 | 暂不实施 |

### 8.4 Event Bus

```ts
export interface DashboardEvent {
  type:
    | 'stage:start' | 'stage:progress' | 'stage:done' | 'stage:error'
    | 'request:captured'    // request 结束时发出
    | 'field:hit'           // 字段访问时发出（带节流）
    | 'coverage:metrics'    // coverage 分析完成时
    | 'ui-evidence:captured'
    | 'run:done' | 'run:failed'
  payload: unknown
  runId: string
  timestamp: string
}
```

注：hook 名 `onRequestCaptured` 表示"捕获到一条完整 request 记录"（含响应），不是开始。Event 与 Hook 一一对应。

---

## 9. Runtime 采集（Phase 2）

### 9.1 链路

```
user code: const user = await api.users.getUser(1)
                                    │
                                    ▼
                    @mk/client/request('GET', '/api/users/1')
                                    │
                  ┌─────────────────┴─────────────────┐
                  │ analysis mode                      │
                  ▼                                    ▼
        fetch('/api/users/1')             Collector.recordRequestStart
                  │
                  ▼
        response data
                  │
                  ▼
        createTrackedProxy(data, ctx)
                  │
                  ├─→ Collector.recordFieldHit (on each access)
                  │
                  └─→ return tracked proxy to user
                          │
                          ▼
              user code: user.name  → Collector.recordFieldHit
              user code: user.email → Collector.recordFieldHit
```

### 9.2 Collector 接口

```ts
export interface CoverageCollector {
  recordRequestStart(event: RequestStartEvent): void
  recordRequestEnd(event: RequestEndEvent): void
  recordRequestError(event: RequestErrorEvent): void
  recordFieldHit(event: FieldHitEvent): void
  flush(): Promise<void>
  reset(): void
}
```

实现：基于内存 queue，周期性 flush 到 SQLite（每 100 条或 1 秒）。

### 9.3 Playwright 集成

```ts
// @playwright/test + mk scenario runner
import { chromium } from 'playwright'

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

// 监听所有网络请求（即使不走 SDK 也能捕获）
page.on('request', req => collector.recordRequestStart({ ... }))
page.on('response', res => collector.recordRequestEnd({ ... }))

// 跑 DSL
await page.goto('http://localhost:5173/users/1')
await page.waitForSelector('[data-page="user-profile"]')
await page.click('[data-action="edit"]')
```

### 9.4 UI Evidence 采集

Playwright 扫描所有带 `data-mk-field` 属性的元素（两种来源）：

1. **`<Field>` 组件**（Section 9.5）— 推荐方式，类型安全
2. **手动属性** — `<span data-mk-field="user.profile.name">{user.name}</span>`

采集逻辑：

```ts
const elements = await page.$$('[data-mk-field]')
for (const el of elements) {
  const field = await el.getAttribute('data-mk-field')
  const visible = await el.isVisible()
  const inViewport = await el.evaluate(e => {
    const r = e.getBoundingClientRect()
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth
  })
  const evidenceType = await el.evaluate(e => {
    if (e.tagName === 'IMG') return 'image-src'
    if (e.tagName === 'A') return 'link-href'
    if (e.getAttribute('aria-label')) return 'aria-label'
    return 'text'
  })
  
  collector.recordUiEvidence({
    field,
    visible,
    inViewport,
    evidenceType,
    selector: `[data-mk-field="${field}"]`,
    route: page.url(),
  })
}
```

**关键约束**：未带 `data-mk-field` 的元素，即使渲染了字段值，**也不会被记录为 UI Evidence**。
这是 anti-cheat 的基础：必须显式声明"我把这个字段渲染给用户看了"。

### 9.5 `<Field>` 组件（可选增强）

```tsx
// @mk/client/src/components/Field.tsx
export function Field({ field, children }: { field: string; children: ReactNode }) {
  return <span data-mk-field={field}>{children}</span>
}
```

Production：保留 `<span data-mk-field="...">`（无追踪，仅 DOM 标记）
Analysis：保留 + collector 记录

---

## 10. Coverage Policy 与 Analyzer

### 10.1 Policy 优先级

```
用户显式 required
> 用户显式 ignored
> 用户显式 optional
> 默认 ignored（*.metadata.*, *.internalRiskScore, *.debugTraceId）
> unknown
```

### 10.2 三层指标

```ts
type CoverageMetrics = {
  requiredCoverage: number      // coveredRequiredFields / totalRequiredFields
  effectiveCoverage: number     // covered(Required+Optional) / total(Required+Optional)
  rawBackendCoverage: number   // coveredAllReturnedFields / totalReturnedFields
}
```

### 10.3 Anti-cheat（基础实现，本 spec）

检测项：
- `display: none` 的元素 → suspicious
- `visibility: hidden` → suspicious
- `<pre>{JSON.stringify(response)}</pre>` → invalid
- offscreen（boundingBox 超出 viewport）→ weak

完整 anti-cheat 在 Spec #2。

### 10.4 Analyzer 输出

```ts
type CoverageReport = {
  runId: string
  generatedAt: string
  metrics: CoverageMetrics
  endpoints: EndpointCoverage[]
  missingRequiredFields: FieldCoverageItem[]
  weakEvidenceFields: FieldCoverageItem[]
  ignoredReturnedFields: FieldCoverageItem[]
  suspiciousCoverage: FieldCoverageItem[]
  manifestOverrides: ManifestOverride[]
}
```

---

## 11. SQLite Schema

### 11.1 表结构

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,  -- running | success | failed
  project_name TEXT,
  dashboard_url TEXT,
  manifest_hash TEXT,
  config_path TEXT,
  resolved_config_path TEXT
);

CREATE TABLE endpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  operation_id TEXT,
  summary TEXT
);

CREATE TABLE manifest_fields (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  direction TEXT NOT NULL,  -- request | response
  status TEXT,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  type TEXT,
  required INTEGER,
  schema_name TEXT,
  description TEXT
);

CREATE TABLE manifest_overrides (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  actual_type TEXT,
  actual_value_state TEXT,
  sample_value_hash TEXT,
  sample_count INTEGER,
  first_seen_at TEXT,
  last_seen_at TEXT,
  override_type TEXT  -- type_mismatch | extra_field | missing_field
);

CREATE TABLE request_traces (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  scenario_id TEXT,
  dsl_step_id TEXT,
  endpoint_id TEXT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  path TEXT,
  status INTEGER,
  duration_ms INTEGER,
  started_at TEXT,
  ended_at TEXT,
  replayable INTEGER,
  replay_safety TEXT  -- safe | idempotent | unsafe | blocked
);

CREATE TABLE request_fields (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  field_id TEXT,
  field_path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  value_state TEXT NOT NULL,  -- present | null | undefined | empty | absent
  value_type TEXT,
  value_preview TEXT,         -- 默认 masked
  value_hash TEXT,
  policy_status TEXT,
  matched_rule_pattern TEXT,
  matched_rule_reason TEXT
);

CREATE TABLE field_hits (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  request_id TEXT,
  endpoint_id TEXT,
  field_id TEXT,
  field_path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_hit_at TEXT,
  last_hit_at TEXT,
  route TEXT,
  source TEXT  -- browser | server
);

CREATE TABLE ui_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  request_id TEXT,
  field_id TEXT,
  field_path TEXT NOT NULL,
  evidence_type TEXT,
  selector TEXT,
  visible INTEGER,
  in_viewport INTEGER,
  hidden INTEGER,  -- display:none, visibility:hidden
  offscreen INTEGER,
  route TEXT,
  screenshot_path TEXT
);

CREATE TABLE coverage_fields (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  endpoint_id TEXT,
  field_path TEXT NOT NULL,
  policy_status TEXT NOT NULL,  -- required | optional | ignored | unknown
  coverage_state TEXT NOT NULL,  -- covered | missing | ignored | notApplicable
  access_hit INTEGER,
  ui_hit INTEGER,
  assertion_hit INTEGER,
  suspicious INTEGER,
  counted_required INTEGER,
  counted_effective INTEGER
);
```

### 11.2 索引

```sql
CREATE INDEX idx_request_traces_run ON request_traces(run_id);
CREATE INDEX idx_request_traces_endpoint ON request_traces(endpoint_id);
CREATE INDEX idx_request_fields_request ON request_fields(request_id);
CREATE INDEX idx_field_hits_run ON field_hits(run_id);
CREATE INDEX idx_field_hits_field ON field_hits(field_id);
CREATE INDEX idx_ui_evidence_run ON ui_evidence(run_id);
CREATE INDEX idx_coverage_fields_run ON coverage_fields(run_id);
CREATE INDEX idx_coverage_fields_state ON coverage_fields(coverage_state);
```

### 11.3 保留策略

`runtime.retainRuns = N`（默认 10），每次新 run 后清理最旧的。

---

## 12. DSL 与 Scenario（基础）

### 12.1 MVP Step 类型

```yaml
steps:
  - id: open-user-profile
    type: goto
    url: /users/1

  - id: wait-profile
    type: waitFor
    selector: "[data-page='user-profile']"

  - id: click-edit
    type: click
    selector: "[data-action='edit']"

  - id: fill-name
    type: fill
    selector: "[data-field='name']"
    value: "Alice"

  - id: assert-user-name-visible
    type: assertFieldVisible
    field: user.profile.name

  - id: screenshot
    type: screenshot
    path: ./screenshots/profile.png
```

### 12.2 不在本 spec

- `waitForRequest`
- `assertVisible`（通用版）
- 复杂分支 / 循环

### 12.3 Replay（GET only，本 spec）

```ts
POST /api/runs/:runId/replay/request/:requestId
  body: { confirm?: boolean }
  response: { requestId: string; status: number; body?: unknown }
```

**Spec #1 范围**：
- ✅ GET / HEAD 自动 replay（无需 confirm）
- ✅ API 端点实现
- ❌ POST/PUT/PATCH/DELETE replay（需 confirm UI）— Spec #2
- ❌ Replay 按钮 UI — Spec #2
- ❌ Scenario replay（`POST /api/runs/:runId/replay/scenario/:scenarioId`）— Spec #2

用户在 dashboard 可通过 curl 调用 API 触发 replay，无需 UI。

---

## 13. Dashboard Server（API 完整，UI 简化）

### 13.1 Server

Fastify + SSE。

### 13.2 API 路由

```
GET  /api/runs
GET  /api/runs/:runId
GET  /api/runs/:runId/manifest
GET  /api/runs/:runId/metrics
GET  /api/runs/:runId/endpoints
GET  /api/runs/:runId/requests
GET  /api/runs/:runId/requests/:requestId
GET  /api/runs/:runId/fields
GET  /api/runs/:runId/ignored
GET  /api/runs/:runId/ui-evidence
GET  /api/runs/:runId/manifest-overrides
GET  /api/events                       # SSE

POST /api/runs/:runId/replay/request/:requestId  # 仅 GET/HEAD（Spec #1 范围）
# POST /api/runs/:runId/replay/scenario/:scenarioId — Spec #2
```

### 13.3 UI（简化版，本 spec）

仅两个页面：
- `/` — Overview（指标卡片 + endpoint 列表 + missing required + ignored returned）
- `/runs/:runId/requests/:requestId` — 请求详情（字段树 + 响应值 masked）

完整 UI（manifest browser、scenarios、plugins、policy editor）在 Spec #2。

---

## 14. Demo App Spec

### 14.1 目录

```
examples/react-vite-demo/
├── backend/                 # 真实后端（任何能输出 OpenAPI 的栈）
│   ├── src/
│   ├── package.json
│   └── openapi.json         # 自动生成的 OpenAPI 文档
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   └── api/             # @mk/client 调用
│   ├── package.json
│   └── mk.config.yml
└── README.md
```

### 14.2 必须演示的字段类型

| 类型 | 字段 | 期望状态 |
|---|---|---|
| required covered | `user.name` | covered |
| required covered + UI evidence | `user.email` | covered + visible |
| required missing | `user.phone` | missing |
| optional covered | `user.lastLoginAt` | covered |
| ignored returned | `user.internalRiskScore` | ignored_returned |
| ignored not returned | `user.debugTraceId` | ignored_not_returned |
| suspicious (hidden) | `user.metadata` | suspicious |
| extra field (no schema) | `data.serverTimestamp` | extra_field (manifest override) |

### 14.3 必须包含的场景

- DSL scenario：`scenarios/user-profile.yml`
- GET replay 成功：`GET /api/users/1`
- POST replay disabled：`POST /api/orders`（blocked 或需 confirm）

---

## 15. 测试策略

### 15.1 单元测试

- Vitest
- 每个包独立测试
- Coverage ≥ 80%

### 15.2 集成测试

- `examples/react-vite-demo` 跑 `npx mk`，断言：
  - SQLite 表行数 > 0
  - report.json 存在
  - 至少一个 missing required 字段被识别
  - 至少一个 ignored returned 字段被识别
  - SDK codegen 文件存在于 `.mk/sdk/`

### 15.3 E2E 测试

- Playwright
- 跑完整 scenario suite
- 截图对比（before / after agent 修复——本 spec 不修 agent，只验证流程）

---

## 16. 风险与缓解

| 风险 | 表现 | 缓解 |
|---|---|---|
| SDK adoption 阻力 | 用户不愿改 `fetch` 为 `api.xxx` | 提供 codemod + fetch monkey-patch fallback |
| Field Proxy 性能 | React StrictMode 下双重代理 | WeakMap 缓存 + plain object check |
| OpenAPI 不准 | Manifest 与实际响应漂移 | runtime override + dashboard diff |
| Proxy 行为破坏 | 引用比较失败 | WeakMap 缓存 + Symbol 跳过 |
| SDK bundle 体积 | Production 超 3KB | tree-shaking + 别名 + 死代码消除 |
| Scenario 启动慢 | Playwright 冷启 | 复用 browser 实例 |
| Manifest 字段爆炸 | 数组 index 撑爆 | path normalizer + hash |
| Playwright 浏览器下载 | CI 环境失败 | 提供 `doctor` 检查 + 手动 install 指引 |

---

## 17. Roadmap（Phase 0–3，本 spec）

### Phase 0：项目骨架（1 周）
- pnpm monorepo
- cli（init / start / run / report / doctor）
- config loader
- kernel + event bus
- plugin-swagger（基础）

### Phase 1：Manifest + SDK Codegen（1-2 周）
- OpenAPI 解析
- Manifest 生成 + field-id
- SDK codegen（OpenAPI → .mk/sdk/）
- @mk/client + @mk/runtime 包

### Phase 2：采集（2 周）
- Field-level Proxy（@mk/runtime/analysis）
- Collector + flush
- Playwright runner
- DSL v0
- Request Trace + SQLite
- UI Evidence 基础（`[data-mk-field]` 扫描）

### Phase 3：分析 + Dashboard API（1-2 周）
- Coverage Policy engine
- Coverage Analyzer
- Anti-cheat v0
- Dashboard Server + SSE
- Dashboard UI 简化版
- Demo app 完整

总计：6-7 周。

---

## 18. 开放问题（spec 实施时可能浮现）

1. SDK codegen 失败（OpenAPI 包含 unhandled 关键字）— fallback 策略待定
2. 用户用 SSR（getServerSideProps）— 字段访问发生在服务端，collector 需双端
3. 用户用 Zustand/Redux 等状态库 — 字段读取追踪可能丢失
4. 大响应（10MB+）— collector queue 撑爆

这些问题在 spec 实施时按风险登记，但不阻塞 MVP 交付。

---

## 19. 验收清单（Definition of Done）

- [ ] `pnpm install` 在 mk 仓库根成功
- [ ] `pnpm build` 成功产出所有 package 的 dist
- [ ] `npx mk` 在 `examples/react-vite-demo/` 跑通完整链路
- [ ] `.mk/runs/{runId}/coverage.db` 存在且含所有表
- [ ] `.mk/runs/{runId}/report.json` 含三层 metrics
- [ ] Dashboard server 在 4317 端口可访问
- [ ] SDK Facade production build ≤ 3KB（gzip）
- [ ] SDK Facade analysis build 含 tracker
- [ ] Manifest override 至少 1 条被识别（demo 含 extra_field）
- [ ] Missing required 字段在 dashboard 显示
- [ ] Ignored returned 字段在 dashboard 显示
- [ ] GET replay 成功
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 集成测试通过

---

## 20. 下一步

本文档为 Spec #1。批准后：

1. 使用 **superpowers:writing-plans** 撰写 implementation plan
2. 按 plan 实施 Phase 0 → 3
3. 完成后进入 Spec #2（Dashboard + UI Evidence + Replay）
4. 最后 Spec #3（Agent + Loop）