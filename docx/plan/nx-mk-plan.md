
```markdown
# mk 完整实现方案

> 项目名：**mk**（repo: nx-mk，包 scope: @nx-mk/*，业务集成契约: @mk/client）
> 定位：通过 `npx mk` 一键启动的 OpenAPI 驱动前端 API/UI 覆盖率分析与 Agent 自动补齐工作台。

> **修订记录**：
> - **2026-09-03**：按 `nx-mk-plan-questions.md` 收口决策（A→K + C-X1/SDK-CG1-3）修订 5 处关键章节——§5.3 SDK Facade、§8 Monorepo 结构 + Phase 1.5 SDK Codegen 包、§10 配置（scenarios.concurrency / dashboard.defaultView / agent.provider、删 ci 段）、§19/§20（SDK 内部行为 + UI evidence 显式标记）、§41/§42/§42.5/§43（MVP 支持 + Roadmap 新增 Phase 1.5 + 风险表）。§40 CI 标记后置。

---

## 1. 项目定位

`mk` 是一个面向前端工程团队的本地开发工具，用于分析后端 API 能力在前端 UI 层面的真实覆盖情况。

它基于 Swagger/OpenAPI 生成 API Manifest，在分析模式下通过运行时字段代理、Playwright/CDP 请求捕获、UI Evidence 采集，生成接口、字段、请求、页面维度的覆盖率报告，并支持：

- Coverage Policy
- Request Trace
- 字段级响应值查看
- DSL 场景复现
- Request Replay
- 插件配置页面
- Agent 自动补齐 UI/API/DSL
- 多轮 loop 直到目标覆盖率达成

一句话定义：

> **mk 是一个通过 `npx mk` 一键启动的 OpenAPI 驱动前端 API/UI 覆盖率分析与 Agent 自动补齐系统。**

---

## 2. 核心目标

### 2.1 解决的问题

传统 API 覆盖率通常只能回答：

```text
接口有没有被调用？
```

但 `mk` 要回答的是：

```
后端返回的字段是否真的被前端读取？
是否进入 UI？
是否对用户可见？
是否被业务场景断言？
哪些字段被策略忽略？
哪些字段后端返回了但前端没有消费？
是否可以复现这次请求？
Agent 能否根据报告自动补齐？
```

---

## 3. 最终用户体验

用户只需要执行一次：

```bash
npx mk
```

首次执行时，如果没有配置，CLI 自动初始化：

```
✔ 检测项目类型
✔ 检测 OpenAPI / Swagger
✔ 生成 mk.config.yml
✔ 生成 mk/scenarios/example.yml
✔ 启动本地 Dashboard
✔ 启动用户 App
✔ 执行分析
✔ 打开报告页面
```

运行中 CLI 实时展示：

```
mk v0.1.0

Dashboard: http://localhost:4317
Current Run: run_20260826_103012
Project: react-vite-demo
Mode: analysis

Pipeline
✔ Load config
✔ Resolve plugins
✔ Generate manifest        128 endpoints / 1,246 fields
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
UI evidence:       76
Ignored returned:  34
Missing required:  pending
```

完成后：

```
Analysis completed

Required Coverage:       86%
Effective Coverage:      72%
Raw Backend Coverage:    49%
Requests Captured:       83
Replayable Requests:     61
Ignored Returned Fields: 38
Missing Required Fields: 12

Report:
http://localhost:4317/runs/run_20260826_103012

Artifacts:
.mk/runs/run_20260826_103012
```

---

## 4. 命名规范

```
项目名：mk
CLI 命令：mk
本地隐藏目录：.mk/
配置文件：mk.config.yml
场景目录：mk/scenarios/
Dashboard 默认端口：4317
```

npm 包建议：

```
mk
```

如果 `mk` 包名不可用，可使用：

```
@mk/cli
@mk/kernel
@mk/runtime
@mk/coverage
@mk/dashboard
@mk/agent-sdk
```

但 CLI bin 仍然暴露为：

```bash
npx mk
```

---

## 5. 产品形态

`mk` 不是一组零散命令，而是：

```
CLI + Local Dashboard + Plugin Runtime + Agent Loop
```

### 5.1 CLI

负责：

```
一键启动
自动初始化
实时进度
启动 Dashboard
启动用户 App
运行分析流水线
展示产物路径
```

### 5.2 Local Dashboard

负责：

```
Manifest 浏览
覆盖率报告
请求详情
字段响应值
Returned but ignored
Replay
DSL
Agent Loop
插件设置
Coverage Policy 编辑
```

### 5.3 SDK Facade（接入方式）

> **决策依据**：C-X1 → **X1-A** 决议（详见 `nx-mk-plan-questions.md` 🚨 → ✅ 已解决冲突 段）。"零侵入"= **业务代码无 if/else 分支**，**不是"不改代码"**；用户接入方式是 SDK Facade，tracker 与生产完全解耦。

用户接入：

```
npm install @mk/client --save  # or @nx-mk/client, 视包名
```

业务代码始终调用：

```tsx
import { api } from '@mk/client'
const user = await api.user.getUser(id)
```

生产模式：

```
api.user.getUser -> fetch wrapper -> data          # SDK 薄壳 ~1-3KB，无 analysis 逻辑
```

分析模式（`npx mk` 启动的 analysis session）：

```
api.user.getUser -> fetch wrapper
  -> bind manifest -> tracked proxy -> collector
  -> data + field-hit / trace events
```

生产 bundle 目标：**tracker 类代码 0 字节**；仅保留 SDK 薄壳（纯 fetch 包装）。

### 5.4 Runtime Instrumentation（SDK 内部行为）

> SDK Facade 内部实现见 §18（策略与中间件）、§19（字段级 Proxy）、§20（UI Evidence）。此前的"5.3 Runtime"描述已迁至此处——它是 SDK 的 analysis 分支，不需用户额外配置。

负责：

```
analysis 模式下的 field-access 追踪（通过 SDK 内部 Proxy）
collector / coverage 收集
UI evidence 增强（需 <Field> / data-mk-field 显式标记，见 §20）
策略与中间件流水线（见 §18）
```

### 5.5 Agent

负责：

```
根据覆盖率缺口生成修复计划
补 UI
补 API 调用
补 DSL 断言
审查 diff
多轮 loop
```

---

## 6. 技术栈

### 6.1 总体技术栈

```
语言：TypeScript
运行时：Node.js
包管理：pnpm workspace
构建：tsup
CLI：Commander
交互式 CLI：@inquirer/prompts
终端进度：ora + log-update
微内核 Hook：tapable / 自研轻量 Hook
OpenAPI 解析：@apidevtools/swagger-parser + openapi-typescript
SDK Codegen（Phase 1.5）：openapi-typescript-codegen / AST 转换（见 §42.5）
场景执行：Playwright
浏览器调试：Playwright CDP
本地数据库：SQLite
SQLite Driver：better-sqlite3
ORM：Drizzle ORM
配置：YAML + Zod
Dashboard Server：Fastify
Dashboard UI：Vite + React
前端路由：TanStack Router
数据请求：TanStack Query
表格：TanStack Table
图表：ECharts / Recharts
编辑器：Monaco Editor
测试：Vitest + Playwright Test
Agent Provider：Claude Code SDK（MVP 仅此一，见 C-X1 / SDK-CG1）
codemod（SDK-CG3）：jscodeshift / ts-morph 扫描 + 替换 `fetch('/api/..')`
```

> 备注：Agent Provider 中的 Custom Command / Custom HTTP adapter 为后置能力（I 段），MVP 不实现。仅 `agent-provider-claude-code` 保留。

---

## 7. 为什么不用 Nest.js / Next.js

### 7.1 不推荐 Nest.js

`mk` 是本地开发工具，不是传统业务后端。

Nest.js 会导致：

```
启动重
结构重
抽象过多
CLI 工具体验变差
```

### 7.2 不推荐 Next.js

Dashboard 是本地分析控制台，不需要 SSR。

Vite + React 更适合：

```
启动快
构建简单
静态资源容易嵌入 CLI
本地服务更轻
```

---

## 8. Monorepo 结构（SDK Facade 接入版）

> **缩写**：报告名称、CLI 二进制、本地目录沿用 `mk` 简写；包发布作用域用 `@nx-mk/*`，业务集成 import 路径保持 `@mk/client` 契约（见 5.3）。

```
nx-mk/                                 # repo 名
  package.json
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  package.json
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json

  packages/
    cli/                               # bin: mk (npx mk)
      src/
        index.ts
        commands/
          start.ts
          init.ts
          run.ts
          report.ts
          replay.ts
          loop.ts
          migrate.ts                   # SDK-CG3：fetch('...') → api.xxx.xxx() codemod
          doctor.ts
        tui/
          render-progress.ts
        bootstrap/
          detect-project.ts
          auto-init.ts
          resolve-config.ts

    client/                            # ← SDK Facade（Phase 1.5 + Phase 2）
      src/
        index.ts                       # host barrel；实际 api.user.getUser() 等由 @mk/client 生成
        middleware/
          auth.ts
          transport.ts
          normalize.ts
        proxy/
          create-tracked-proxy.ts      # §19：字段级 Proxy
          path-normalizer.ts           # §17
          proxy-cache.ts               # WeakMap 缓存
        collector/
          collector.ts                 # field-hit 收集
          browser-collector.ts
          noop-collector.ts
        react/
          Field.tsx                    # §20：UI Evidence
          useField.ts
        codegen/
          generate-sdk.ts              # SDK-CG1/2：OpenAPI → typed sdk（见 §42.5）
          ast/
            emit-endpoint.ts
        migrate/
          fetch-to-sdk.ts              # SDK-CG3：codemod 核心
          fetch-patch.ts               # SDK-CG3：fetch monkey-patch fallback
        mode/
          production.ts               # 薄壳，仅 fetch wrapper
          analysis.ts                 # 包上 analysis 增强（proxy + collector）
          index.ts

    kernel/
      src/
        kernel.ts
        hooks.ts
        plugin.ts
        context.ts
        event-bus.ts
        run-state.ts
        pipeline.ts
        goal-loop.ts
        initial-coverage.ts

    config/
      src/
        schema.ts
        load-config.ts
        write-config.ts
        resolve-config.ts
        defaults.ts
        __tests__/

    manifest/
      src/
        types.ts
        openapi/
          parse-openapi.ts
          normalize-openapi.ts
          schema-flatten.ts
        field-id.ts
        schema-diff.ts
        manifest-store.ts
        __tests__/

    coverage/
      src/
        policy/
          policy-engine.ts
          matcher.ts
          normalize-policy.ts
        request-trace/
          trace-store.ts
          field-extractor.ts
          value-masker.ts
        evidence/
          ui-evidence.ts
          dom-scanner.ts
        analyzer/
          coverage-analyzer.ts
          metrics.ts
          anti-cheat.ts
        db/
          schema.ts
          client.ts
          migrations/

    scenario/
      src/
        dsl-schema.ts
        dsl-loader.ts
        runner.ts
        playwright-runner.ts
        request-replay.ts
        scenario-replay.ts
        __tests__/

    dashboard-server/
      src/
        server.ts
        routes/
          runs.ts
          manifest.ts
          requests.ts
          fields.ts
          plugins.ts
          settings.ts
          replay.ts
          agent.ts
        events/
          sse.ts

    dashboard-ui/
      src/
        main.tsx
        routes/
          overview.tsx
          run-detail.tsx
          manifest.tsx
          endpoints.tsx
          requests.tsx
          request-detail.tsx
          fields.tsx
          ignored.tsx
          scenarios.tsx
          agent.tsx
          settings/
            plugins.tsx
            policy.tsx
            agent.tsx
            replay.tsx
        components/
          CoverageCards.tsx
          RequestTable.tsx
          FieldTree.tsx
          ManifestBrowser.tsx
          PluginSettingsForm.tsx

    agent-sdk/
      src/
        define-agent.ts
        context.ts
        provider.ts
        result.ts
        guard.ts
        project-api.ts

    plugin-swagger/
      src/
        index.ts
        __tests__/

    plugin-coverage/
      src/
        index.ts
        __tests__/

    plugin-agent/
      src/
        index.ts
        __tests__/

  examples/
    react-vite-demo/                   # 详见 SDK-CG1/K-X1 决策
      app/                             # React + Vite 前端
      server/                          # Hono + zod-openapi 后端（自产 OpenAPI）
      swagger/                         # 由 server 导出的 swagger.json（供 mk 输入）
    next-demo-later/

  docs/
    architecture.md
    manifest-spec.md
    coverage-policy-spec.md
    request-trace-spec.md
    dsl-spec.md
    runtime-instrumentation.md
    agent-plugin-spec.md
    mvp-scope.md
    plan/
      nx-mk-plan.md                    # ← 本文件（已落 SDK-CG1/2/3 决策）
      nx-mk-plan-questions.md          # ← 2026-09-03 已收口
```

---

## 9. CLI 命令设计

主命令：

```bash
npx mk
```

等价于：

```bash
npx mk start
```

高级命令：

```bash
npx mk start      # 一键启动 Dashboard + 分析
npx mk init       # 只初始化配置
npx mk run        # 只运行分析
npx mk report     # 打开报告
npx mk replay     # 复现请求或场景
npx mk loop       # 运行 Agent Loop
npx mk migrate    # SDK-CG3：axios/fetch → @mk/client codemod（扫描 + 替换）
npx mk doctor     # 环境检查
```

> `npx mk ci` 已移出 MVP（见 42 Roadmap；E1/E2 CI 插件暂不实施）。

### 9.1 默认行为

如果没有配置：

```
init + start dashboard + run analysis
```

如果已有配置：

```
start dashboard + run analysis
```

---

## 10. 配置文件设计

配置文件：

```
mk.config.yml
```

示例：

```yaml
version: 1

project:
  name: my-app
  framework: react
  bundler: vite

openapi:
  input: ./swagger.json
  watch: true

app:
  command: pnpm dev
  url: http://localhost:5173
  analysisEnv:
    VITE_MK_MODE: analysis

runtime:
  mode: analysis
  instrumentation:
    proxy: true
    uiEvidence: true
    collectStack: sampled
    stackSampleRate: 0.05

coveragePolicy:
  required:
    - pattern: user.name
      reason: 用户主标识，必须展示
    - pattern: user.email
      reason: 联系信息，必须展示
    - pattern: user.avatarUrl
      reason: 用户头像，必须展示

  optional:
    - pattern: user.lastLoginAt
      reason: 辅助信息
    - pattern: user.phone
      reason: 非所有业务都需要展示

  ignored:
    - pattern: user.internalRiskScore
      reason: 内部风控字段，不应展示
    - pattern: user.debugTraceId
      reason: 调试字段
    - pattern: "*.metadata.*"
      reason: 元数据默认忽略
    - pattern: "*.createdBySystem"
      reason: 系统生成字段默认忽略

privacy:
  responseValues:
    mode: masked # masked | raw | none
  mask:
    - pattern: "*.email"
      strategy: email
    - pattern: "*.phone"
      strategy: phone
    - pattern: "*.token"
      strategy: full
    - pattern: "*.password"
      strategy: full
    - pattern: "*.address"
      strategy: partial

scenarios:
  include:
    - mk/scenarios/**/*.yml
  concurrency: 3  # F3: 每个 scenario 独立 browser context，并发 3（默认，可配最大 10）

replay:
  allowMethods:
    - GET
    - HEAD
  requireConfirmation:
    - POST
    - PUT
    - PATCH
    - DELETE
  block:
    - pattern: "/api/payment/**"
    - pattern: "/api/delete/**"

agent:
  enabled: true
  provider:
    type: claude-code  # MVP 仅 claude-code（D2 已定）；custom-http/command 后置
    model: claude-sonnet-4

  permission:
    mode: suggest-diff # read-only | suggest-diff | workspace-write | auto-apply

  plugins:
    - name: api-ui-agent
      enabled: true
    - name: dsl-agent
      enabled: true
    - name: review-agent
      enabled: true

  allowEdit:
    - src/pages/**
    - src/components/**
    - src/routes/**
    - src/api/generated/**
    - mk/scenarios/**

  denyEdit:
    - src/coverage/**
    - src/api/runtime/**
    - package.json
    - pnpm-lock.yaml

  loop:
    maxIterations: 5
    rollbackOnRegression: true
    stopIfNoImprovementRounds: 2

dashboard:
  port: 4317
  open: true
  defaultView: latest  # G3: latest | history，默认 latest（按需切）

# CI 插件暂不实施（E1/E2），MVP 删除 ci 段；后置时再加
```

每次运行生成 resolved config：

```
.mk/runs/{runId}/config.resolved.json
```

用于记录：

```
用户配置
默认配置
插件默认配置
环境变量展开结果
本次运行最终配置
```

---

## 11. 产物目录

```
.mk/
  manifest.json
  runs/
    run_20260826_103012/
      coverage.db
      report.json
      config.resolved.json
      dsl.generated.yml
      artifacts/
        screenshots/
        traces/
        agent-diffs/
```

CLI 完成后展示：

```
Manifest:
.mk/manifest.json

Run DB:
.mk/runs/run_20260826_103012/coverage.db

Report JSON:
.mk/runs/run_20260826_103012/report.json

Generated DSL:
.mk/runs/run_20260826_103012/dsl.generated.yml

Dashboard:
http://localhost:4317/runs/run_20260826_103012
```

---

## 12. 总体架构

```
npx mk
  │
  ▼
CLI Bootstrap
  │
  ├── detect project
  ├── auto init config
  ├── resolve plugins
  ├── start dashboard
  └── run pipeline
          │
          ▼
      Kernel Event Bus
          │
  ┌───────┴────────┐
  ▼                ▼
Terminal UI     Web Dashboard
  │                │
  ▼                ▼
Live Progress   Manifest / Report / Plugins / Agent
  │                │
  └───────┬────────┘
          ▼
    .mk/runs/{runId}
          │
          ├── manifest.json
          ├── coverage.db
          ├── report.json
          ├── dsl.generated.yml
          └── artifacts/
```

---

## 13. Pipeline 流程

一次完整运行：

```
1. Bootstrap
   - 检测项目
   - 解析配置
   - 自动初始化
   - 解析插件

2. Start Dashboard
   - 启动 Fastify
   - 提供 React Dashboard
   - 建立 SSE 通道

3. Generate Manifest
   - 解析 OpenAPI
   - 生成 endpoint
   - flatten schema
   - 生成 fieldId
   - 写入 .mk/manifest.json

4. Start User App
   - 执行 app.command
   - 注入 analysis env
   - 等待 app.url 可访问

5. Run Scenarios
   - 启动 Playwright
   - 执行 DSL
   - 捕获 request/response
   - 采集 field hit
   - 扫描 UI evidence

6. Analyze Coverage
   - 合并 Manifest / Trace / Field Hit / UI Evidence
   - 应用 Coverage Policy
   - 计算覆盖率
   - 检测 suspicious coverage
   - 生成 report.json

7. Dashboard Report
   - 请求列表
   - 字段详情
   - Returned but ignored
   - Replay
   - Agent Loop
```

---

## 14. 微内核设计

### 14.1 Kernel 职责

```
插件注册
生命周期管理
Hook 分发
Pipeline 调度
RunState 管理
EventBus 推送
模式隔离
```

### 14.2 Plugin 协议

```tsx
type RuntimeMode =
  | "production"
  | "development"
  | "analysis"
  | "test"
  | "ci"

interface KernelPlugin {
  name: string
  version: string
  description?: string
  modes?: RuntimeMode[]

  configSchema?: unknown
  defaultConfig?: unknown

  setup(ctx: KernelContext): Promise<void> | void
}
```

### 14.3 Hook 设计

```tsx
interface KernelHooks {
  onBootstrap: AsyncSeriesHook<[BootstrapContext]>
  onConfigResolved: AsyncSeriesHook<[ResolvedConfig]>
  onManifestGenerated: AsyncSeriesHook<[ApiManifest]>
  onDashboardStarted: AsyncSeriesHook<[DashboardInfo]>
  onAppStarted: AsyncSeriesHook<[AppInfo]>
  onScenarioStarted: AsyncSeriesHook<[ScenarioContext]>
  onRequestCaptured: AsyncSeriesHook<[RequestTrace]>
  onFieldHit: AsyncSeriesHook<[FieldHitEvent]>
  onUiEvidenceCaptured: AsyncSeriesHook<[UiEvidence]>
  onCoverageAnalyzed: AsyncSeriesHook<[CoverageReport]>
  onAgentIteration: AsyncSeriesHook<[AgentIterationContext]>
  onRunCompleted: AsyncSeriesHook<[RunResult]>
  onRunFailed: AsyncSeriesHook<[RunError]>
}
```

---

## 15. RunState 与实时进度

```tsx
type RunStage =
  | "bootstrap"
  | "config"
  | "plugins"
  | "manifest"
  | "dashboard"
  | "app"
  | "browser"
  | "scenario"
  | "capture"
  | "analyze"
  | "report"
  | "agent"
  | "done"
  | "failed"

type RunState = {
  runId: string
  startedAt: string
  dashboardUrl?: string

  stages: Array<{
    id: RunStage
    name: string
    status: "pending" | "running" | "success" | "failed" | "skipped"
    progress?: {
      current: number
      total: number
    }
    summary?: string
    error?: string
  }>

  metrics: {
    endpoints?: number
    schemas?: number
    fields?: number
    requestsCaptured?: number
    fieldsReturned?: number
    fieldHits?: number
    uiEvidence?: number
    ignoredReturned?: number
    missingRequired?: number
    requiredCoverage?: number
    effectiveCoverage?: number
    rawBackendCoverage?: number
  }

  artifacts: {
    manifestPath?: string
    dbPath?: string
    reportPath?: string
    dslPath?: string
  }
}
```

CLI 和 Dashboard 订阅同一个 RunState。

实时通信使用 SSE：

```
GET /api/events
```

事件：

```tsx
type DashboardEvent =
  | { type: "stage:start"; stage: string }
  | { type: "stage:progress"; stage: string; current: number; total: number }
  | { type: "stage:done"; stage: string; summary?: unknown }
  | { type: "stage:error"; stage: string; error: string }
  | { type: "request:captured"; requestId: string; endpointId?: string }
  | { type: "coverage:metrics"; metrics: CoverageMetrics }
  | { type: "agent:iteration"; iteration: number; status: string }
```

---

## 16. Manifest 设计

Manifest 是 OpenAPI 转换后的中间契约。

### 16.1 Manifest 类型

```tsx
type ApiManifest = {
  version: string
  source: {
    type: "openapi"
    input: string
    hash: string
  }

  generatedAt: string

  endpoints: ApiEndpoint[]
  schemas: Record<string, ApiSchema>
  fields: ApiField[]
}
```

### 16.2 Endpoint

```tsx
type ApiEndpoint = {
  id: string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"
  path: string
  operationId?: string
  summary?: string
  tags?: string[]

  request?: {
    pathParams?: ApiField[]
    query?: ApiField[]
    headers?: ApiField[]
    body?: SchemaRef
  }

  responses: Array<{
    status: string
    schema?: SchemaRef
    fields: ApiField[]
  }>
}
```

### 16.3 Field

```tsx
type ApiField = {
  id: string
  endpointId: string
  direction: "request" | "response"
  status?: string

  path: string
  normalizedPath: string

  name: string
  type: string
  required?: boolean
  nullable?: boolean
  description?: string
  example?: unknown
  enum?: string[]

  schemaName?: string
  source: {
    openapiPointer: string
  }
}
```

### 16.4 Field ID 规范

Field ID 必须稳定。

推荐原始 key：

```
{method}:{path}:{direction}:{status}:{normalizedFieldPath}
```

例如：

```
GET:/users/{id}:response:200:data.avatarUrl
```

最终 ID 可以 hash：

```tsx
fieldId = stableHash({
  method,
  path,
  direction,
  status,
  normalizedFieldPath,
})
```

报告里保留可读字段：

```tsx
fieldKey: "GET:/users/{id}:response:200:data.avatarUrl"
```

---

## 17. 路径归一化

数组路径需要归一化。

原始路径：

```
orders.0.items.2.skuName
```

归一化：

```
orders[].items[].skuName
```

目的：

```
避免字段数量爆炸
便于和 Manifest 对齐
便于统计覆盖率
```

---

## 18. Runtime Instrumentation

### 18.1 模式解耦（SDK Facade 接入层）

> SDK Facade 是接入方式本身：用户装 `@mk/client`，业务代码改用 `api.user.getUser()`；由 SDK 根据模式自动切换内部行为（见 5.3）。**"零侵入"= 业务代码无 if/else 分支，并非"不改代码"**。

业务代码始终调用：

```tsx
const user = await api.user.getUser(id)
```

生产模式：

```
api.user.getUser -> fetch -> data
```

分析模式：

```
api.user.getUser -> fetch -> bind manifest -> tracked proxy -> collector -> data
```

### 18.2 Strategy + Middleware

```tsx
type ApiMiddleware = (
  ctx: ApiRequestContext,
  next: () => Promise<ApiResponse>
) => Promise<ApiResponse>
```

production middlewares：

```tsx
[
  authMiddleware,
  fetchMiddleware,
  normalizeMiddleware
]
```

analysis middlewares：

```tsx
[
  authMiddleware,
  fetchMiddleware,
  normalizeMiddleware,
  bindManifestMiddleware,
  fieldProxyMiddleware,
  coverageCollectorMiddleware
]
```

---

### 19. 字段级 Proxy（SDK Facade 内部行为）

> 本段描述的是 SDK Facade 在 analysis 模式下的 **内部实现**，不是用户配置的 proxy。用户无须在 Vite/plugin 层额外配置 proxy——SDK Facade 自动完成 `fetch -> bind manifest -> tracked proxy -> collector`。

### 19.1 目标

在字段被读取时记录：

```
requestId
endpointId
fieldPath
normalizedPath
hit count
route
timestamp
```

### 19.2 实现示例

```tsx
function createTrackedProxy<T extends object>(
  target: T,
  options: {
    requestId: string
    endpointId: string
    basePath: string
    collector: CoverageCollector
  }
): T {
  if (!shouldProxy(target)) return target

  const cached = proxyCache.get(target)
  if (cached) return cached as T

  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(obj, prop, receiver)
      }

      const value = Reflect.get(obj, prop, receiver)
      const fieldPath = normalizePath(`${options.basePath}.${String(prop)}`)

      options.collector.hit({
        requestId: options.requestId,
        endpointId: options.endpointId,
        fieldPath,
        type: "get",
        timestamp: Date.now(),
      })

      if (shouldProxy(value)) {
        return createTrackedProxy(value, {
          ...options,
          basePath: fieldPath,
        })
      }

      return value
    },
  })

  proxyCache.set(target, proxy)
  return proxy
}
```

### 19.3 不代理对象

必须跳过：

```
Date
File
Blob
Map
Set
WeakMap
WeakSet
Promise
Error
RegExp
URL
FormData
ArrayBuffer
class instance
```

只代理：

```
plain object
array
```

### 19.4 缓存

使用 WeakMap：

```tsx
const proxyCache = new WeakMap<object, object>()
```

避免：

```
React useEffect 无限触发
引用比较失效
性能问题
```

---

## 20. UI Evidence（需显式标记）

> 字段被读取不代表用户看到了：**UI Evidence 唯一可靠来源是显式标记**。业务代码须用 `<Field field="...">` 或 `data-mk-field` 标记字段归属（见 18.1/Agent 权限模型）。后续可提供 codemod / Babel/SWC 自动注入降低成本（后置）。

因此需要单独采集 UI Evidence。

### 20.1 Field 组件

业务代码可写：

```tsx
<Field field="user.profile.name">
  {user.name}
</Field>
```

生产模式：

```tsx
export function Field({ children }) {
  return <>{children}</>
}
```

分析模式：

```tsx
export function Field({ field, children }) {
  return (
    <span data-mk-field={field}>
      {children}
    </span>
  )
}
```

### 20.2 Evidence 类型

```tsx
type UiEvidenceType =
  | "text"
  | "attribute"
  | "image-src"
  | "link-href"
  | "aria-label"
  | "form-value"
  | "component-prop"
```

### 20.3 可见性判断

Playwright 检查：

```
locator.isVisible()
boundingBox()
computedStyle
viewport intersection
```

区分：

```
visible
hidden
offscreen
in viewport
attribute only
```

---

## 21. Coverage Policy

### 21.1 核心原则

`ignored` 不等于消失。

ignored 字段：

```
不进入有效覆盖率分母
仍然在报告展示
显示命中规则
显示忽略原因
如果后端返回，需要明确告知用户
```

### 21.2 Policy 状态

```tsx
type CoveragePolicyStatus =
  | "required"
  | "optional"
  | "ignored"
  | "unknown"
```

### 21.3 字段覆盖状态

```tsx
type FieldCoverageState =
  | "covered"
  | "missing"
  | "ignored"
  | "notApplicable"
```

### 21.4 Policy Decision

```tsx
type PolicyDecision = {
  fieldId: string
  fieldPath: string

  status: CoveragePolicyStatus
  countedInRequiredCoverage: boolean
  countedInEffectiveCoverage: boolean

  matchedRule?: {
    source: "user-config" | "default" | "manifest-tag" | "annotation"
    pattern: string
    reason?: string
  }
}
```

### 21.5 规则优先级

推荐：

```
用户显式 required
>
用户显式 ignored
>
用户显式 optional
>
默认 ignored
>
unknown
```

例如：

```yaml
required:
  - user.metadata.displayName

ignored:
  - "*.metadata.*"
```

最终：

```
user.metadata.displayName => required
```

### 21.6 覆盖率指标

```tsx
requiredCoverage =
  coveredRequiredFields / totalRequiredFields

effectiveCoverage =
  coveredRequiredAndOptionalFields / totalRequiredAndOptionalFields

rawBackendFieldCoverage =
  coveredAllReturnedFields / totalReturnedFields
```

Dashboard 展示：

```
Required Coverage: 92%
Effective Coverage: 78%
Raw Backend Field Coverage: 53%
Ignored Returned Fields: 38
```

---

## 22. Returned but ignored

需要专门页面展示：

```
后端返回了，但命中 ignored 规则的字段
```

示例：

```
Returned but ignored: 12 fields

- data.internalRiskScore
  endpoint: GET /users/{id}
  matched rule: user.internalRiskScore
  reason: 内部风控字段
  sample value: number, present
  requests: 8

- data.metadata.traceId
  endpoint: GET /users/{id}
  matched rule: *.metadata.*
  reason: 元数据默认忽略
  sample value: string, masked
  requests: 8
```

提示：

```
如果这些字段实际应该展示，请移动到 required 或 optional。
```

---

## 23. Request Trace

每一次请求都要成为可审计对象。

### 23.1 RequestTrace

```tsx
type RequestTrace = {
  requestId: string
  traceId: string

  scenarioId?: string
  dslStepId?: string

  endpointId?: string
  method: string
  url: string
  path?: string

  request: {
    headers?: Record<string, string>
    query?: Record<string, unknown>
    params?: Record<string, unknown>
    body?: unknown
    startedAt: string
  }

  response: {
    status: number
    headers?: Record<string, string>
    bodyMasked?: unknown
    endedAt: string
    durationMs: number
  }

  fields: RequestFieldTrace[]

  runtime: {
    route?: string
    pageUrl?: string
    mode: "analysis"
    side: "client" | "server" | "both"
  }

  replay: {
    replayable: boolean
    safety: "safe" | "idempotent" | "unsafe" | "blocked"
    dslRequestId?: string
    dslScenarioId?: string
    dslStepId?: string
    reason?: string
  }
}
```

### 23.2 RequestFieldTrace

```tsx
type RequestFieldTrace = {
  fieldId?: string
  fieldPath: string
  normalizedPath: string

  valueState: "present" | "null" | "undefined" | "empty" | "absent"
  valueType: string
  valuePreview?: string
  valueHash?: string

  policyStatus: "required" | "optional" | "ignored" | "unknown"
  matchedPolicyRule?: {
    pattern: string
    reason?: string
  }

  access: {
    hit: boolean
    count: number
    firstHitAt?: string
  }

  uiEvidence: {
    hit: boolean
    evidenceType?: UiEvidenceType
    selector?: string
    visible?: boolean
    inViewport?: boolean
  }

  assertion: {
    hit: boolean
    dslStepId?: string
  }
}
```

---

## 24. 响应值展示与隐私

请求详情页支持查看字段响应值，但必须默认脱敏。

默认保存：

```
valueType
valueState
length
hash
masked preview
```

示例：

```json
{
  "fieldPath": "data.email",
  "valueType": "string",
  "valueState": "present",
  "valuePreview": "j***@gmail.com",
  "valueHash": "sha256:abc123"
}
```

配置：

```yaml
privacy:
  responseValues:
    mode: masked # masked | raw | none
  mask:
    - pattern: "*.email"
      strategy: email
    - pattern: "*.phone"
      strategy: phone
    - pattern: "*.token"
      strategy: full
    - pattern: "*.password"
      strategy: full
```

---

## 25. SQLite 数据库设计

### 25.1 runs

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  project_name TEXT,
  dashboard_url TEXT,
  manifest_hash TEXT,
  config_path TEXT,
  resolved_config_path TEXT
);
```

### 25.2 endpoints

```sql
CREATE TABLE endpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  operation_id TEXT,
  summary TEXT
);
```

### 25.3 manifest_fields

```sql
CREATE TABLE manifest_fields (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  type TEXT,
  required INTEGER,
  schema_name TEXT,
  description TEXT
);
```

### 25.4 request_traces

```sql
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
  replay_safety TEXT,
  replay_reason TEXT
);
```

### 25.5 request_fields

```sql
CREATE TABLE request_fields (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  field_id TEXT,
  field_path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  value_state TEXT NOT NULL,
  value_type TEXT,
  value_preview TEXT,
  value_hash TEXT,
  policy_status TEXT,
  matched_rule_pattern TEXT,
  matched_rule_reason TEXT
);
```

### 25.6 field_hits

```sql
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
  source TEXT
);
```

### 25.7 ui_evidence

```sql
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
  route TEXT,
  screenshot_path TEXT
);
```

### 25.8 coverage_fields

```sql
CREATE TABLE coverage_fields (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  endpoint_id TEXT,
  field_path TEXT NOT NULL,
  policy_status TEXT NOT NULL,
  coverage_state TEXT NOT NULL,
  access_hit INTEGER,
  ui_hit INTEGER,
  assertion_hit INTEGER,
  suspicious INTEGER,
  counted_required INTEGER,
  counted_effective INTEGER
);
```

### 25.9 agent_iterations

```sql
CREATE TABLE agent_iterations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  before_coverage REAL,
  after_coverage REAL,
  diff_path TEXT,
  started_at TEXT,
  ended_at TEXT
);
```

---

## 26. DSL 设计

### 26.1 Scenario DSL

```yaml
version: 1

scenarios:
  - id: user-profile-basic
    name: 用户详情页基础覆盖
    route: /users/1

    steps:
      - id: open-user-profile
        type: goto
        url: /users/1

      - id: wait-profile
        type: waitFor
        selector: "[data-page='user-profile']"

      - id: assert-user-name
        type: assertFieldVisible
        field: user.profile.name

      - id: assert-user-email
        type: assertFieldVisible
        field: user.profile.email
```

### 26.2 Request DSL

```yaml
requests:
  - id: req-get-user-001
    from:
      scenarioId: user-profile-basic
      stepId: open-user-profile

    endpointId: user.getUser
    method: GET
    url: /api/users/1

    auth:
      type: browserSession

    expect:
      status: 200
      fields:
        - path: data.name
          state: present
        - path: data.email
          state: present
```

### 26.3 MVP Step 类型

```
goto
click
fill
waitFor
waitForRequest
assertVisible
assertFieldVisible
screenshot
```

---

## 27. Replay 设计

### 27.1 两类 Replay

| 类型            | 用途                                |
| --------------- | ----------------------------------- |
| Replay Scenario | 复现 UI 流程、字段展示、UI Evidence |
| Replay Request  | 复现单次 API 请求、响应字段         |

### 27.2 安全等级

```tsx
type ReplaySafety =
  | "safe"
  | "idempotent"
  | "unsafe"
  | "blocked"
```

默认规则：

```
GET/HEAD => safe
PUT with idempotency key => idempotent
POST/PATCH/DELETE => unsafe
payment/delete 等敏感路径 => blocked
```

### 27.3 Dashboard 操作

请求详情页提供：

```
[Replay scenario] [Replay request] [Export DSL] [Copy curl]
```

如果危险：

```
POST /orders
Replay disabled: unsafe method requires confirmation
```

---

## 28. Coverage Analyzer

### 28.1 输入

```
Manifest
Coverage Policy
Request Traces
Field Hits
UI Evidence
DSL Assertions
```

### 28.2 输出

```tsx
type CoverageReport = {
  runId: string

  metrics: {
    requiredCoverage: number
    effectiveCoverage: number
    rawBackendFieldCoverage: number

    endpointsTotal: number
    endpointsCalled: number

    fieldsTotal: number
    fieldsReturned: number
    requiredFields: number
    missingRequiredFields: number
    ignoredReturnedFields: number
    suspiciousFields: number
  }

  missingRequiredFields: FieldCoverageItem[]
  weakEvidenceFields: FieldCoverageItem[]
  ignoredReturnedFields: FieldCoverageItem[]
  suspiciousCoverage: FieldCoverageItem[]

  endpoints: EndpointCoverage[]
  requests: RequestTraceSummary[]
}
```

---

## 29. Evidence Quality 与反作弊

### 29.1 Evidence Quality

```tsx
type EvidenceQuality =
  | "valid"
  | "weak"
  | "suspicious"
  | "invalid"
```

示例：

```
visible text => valid
image src => valid
aria-label => weak
hidden DOM => suspicious
JSON.stringify dump => suspicious
console.log get => invalid
```

### 29.2 反作弊检测

需要检测：

```
hidden DOM 覆盖
display:none
visibility:hidden
offscreen
JSON.stringify 全量 dump
<pre>{JSON.stringify(response)}</pre>
只添加 data-mk-field 但不展示真实值
ignored 字段被展示
console.log 触发字段访问
```

---

## 30. Dashboard 页面设计

### 30.1 页面结构

```
/
  Overview 当前运行总览

/runs
  历史运行记录

/runs/:runId
  本次报告总览

/runs/:runId/manifest
  Manifest 浏览器

/runs/:runId/endpoints
  接口覆盖页

/runs/:runId/requests
  请求列表

/runs/:runId/requests/:requestId
  请求详情 + 字段响应值 + Replay

/runs/:runId/fields
  字段覆盖页

/runs/:runId/ignored
  Returned but ignored

/runs/:runId/scenarios
  DSL 场景页

/runs/:runId/agent
  Agent Loop 页

/settings
  全局设置

/settings/plugins
  插件设置

/settings/policy
  Coverage Policy 编辑

/settings/agent
  Agent Provider 设置

/settings/replay
  Replay 安全策略
```

### 30.2 API 路由

```
GET /api/runs
GET /api/runs/:runId
GET /api/runs/:runId/manifest
GET /api/runs/:runId/metrics
GET /api/runs/:runId/endpoints
GET /api/runs/:runId/requests
GET /api/runs/:runId/requests/:requestId
GET /api/runs/:runId/fields
GET /api/runs/:runId/ignored

POST /api/runs/:runId/replay/request/:requestId
POST /api/runs/:runId/replay/scenario/:scenarioId

GET /api/plugins
PATCH /api/plugins/:pluginName/config

GET /api/settings
PATCH /api/settings/policy
PATCH /api/settings/agent
PATCH /api/settings/replay

GET /api/events
```

---

## 31. 插件设置页面

插件需要导出配置 schema。

```tsx
interface KernelPlugin {
  name: string
  version: string
  description?: string
  configSchema?: unknown
  defaultConfig?: unknown
  setup(ctx: KernelContext): void
}
```

示例：

```tsx
export default definePlugin({
  name: "swagger",
  version: "0.1.0",

  configSchema: z.object({
    input: z.string().default("./swagger.json"),
    watch: z.boolean().default(true),
  }),

  setup(ctx) {
    // plugin setup
  }
})
```

Dashboard 请求：

```
GET /api/plugins
```

返回：

```json
[
  {
    "name": "swagger",
    "version": "0.1.0",
    "enabled": true,
    "config": {
      "input": "./swagger.json",
      "watch": true
    },
    "schema": {}
  }
]
```

用户在页面修改后：

```
PATCH /api/plugins/swagger/config
```

写回：

```
mk.config.yml
```

---

## 32. Agent 设计

### 32.1 总体设计

Agent 层分为三层：

```
Agent Runtime
  系统原生提供，负责上下文、权限、循环、审计、回滚

Agent Provider
  可配置，负责调用不同 AI 能力，如 Claude Code SDK / OpenAI / 本地模型 / 自定义 HTTP

Agent Plugin
  用户可写，负责具体任务策略，如补 UI、补测试、补 DSL、补 API 封装
```

### 32.2 架构

```
Coverage Report
      │
      ▼
Agent Runtime
      │
      ├── Provider Adapter: Claude Code SDK
      ├── Provider Adapter: OpenAI
      ├── Provider Adapter: Local LLM
      └── Provider Adapter: Custom Command
      │
      ▼
Agent Plugin
      │
      ├── api-ui-agent
      ├── api-client-agent
      ├── dsl-agent
      ├── policy-agent
      └── review-agent
      │
      ▼
Code Diff / DSL Diff / Policy Suggestion / Report
```

---

## 33. Agent SDK

官方提供：

```
@mk/agent-sdk
```

核心协议：

```tsx
export interface CoverageAgentPlugin {
  name: string
  version: string
  capabilities: AgentCapability[]

  plan(ctx: AgentContext): Promise<AgentPlan>
  apply(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult>
  verify?(ctx: AgentContext, result: AgentApplyResult): Promise<AgentVerifyResult>
}
```

示例：

```tsx
import { defineCoverageAgent } from "@mk/agent-sdk"

export default defineCoverageAgent({
  name: "custom-ui-agent",
  version: "1.0.0",
  capabilities: ["fix-ui-coverage"],

  async plan(ctx) {
    const gaps = ctx.coverage.missingRequiredFields()

    return {
      tasks: gaps.map(field => ({
        type: "render-field",
        fieldId: field.fieldId,
        reason: field.reason,
      }))
    }
  },

  async apply(ctx, plan) {
    return ctx.ai.edit({
      instructions: `
        Fix missing required UI coverage.
        Do not render ignored fields.
        Add visible UI evidence.
      `,
      files: ctx.project.allowedFiles(),
      context: {
        manifest: ctx.manifest.summary(),
        policy: ctx.policy.summary(),
        gaps: plan.tasks,
      }
    })
  }
})
```

---

## 34. Agent Provider

核心接口：

```tsx
interface AgentProvider {
  name: string

  generate(input: AgentGenerateInput): Promise<AgentGenerateOutput>

  edit(input: AgentEditInput): Promise<AgentEditOutput>

  review?(input: AgentReviewInput): Promise<AgentReviewOutput>
}
```

原生提供：

```
@mk/agent-provider-claude-code
@mk/agent-provider-command
@mk/agent-provider-http
```

推荐默认：

```yaml
agent:
  provider:
    type: claude-code
    model: claude-sonnet-4
```

也支持：

```yaml
agent:
  provider:
    type: custom-http
    endpoint: http://internal-agent.company.com/coverage
```

或：

```yaml
agent:
  provider:
    type: command
    command: pnpm custom-agent
```

---

## 35. 内置 Agent 插件

### 35.1 api-ui-agent

职责：

```
根据 missing required fields 补 UI 展示
添加 data-mk-field / Field wrapper
避免 ignored 字段
```

### 35.2 api-client-agent

职责：

```
根据 Manifest 生成或修复 API client 调用
```

### 35.3 dsl-agent

职责：

```
根据 Request Trace 自动生成或补充 DSL scenario / request replay
```

### 35.4 policy-agent

职责：

```
分析 ignored / unknown 字段，建议用户是否调整 Coverage Policy
```

注意：

```
policy-agent 默认只建议，不自动修改 policy。
```

### 35.5 review-agent

职责：

```
审查其他 Agent 生成的 diff
检查 hidden coverage
检查 JSON dump
检查 ignored field render
检查 UI regression
```

---

## 36. Agent 权限模型（对齐 D1 决策）

```
read-only
suggest-diff       # MVP 默认
workspace-write    # Phase 5+
auto-apply         # Phase 5+ / opt-in
```

| 模式            | 能力                  |
| --------------- | --------------------- |
| read-only       | 只分析，不改文件      |
| suggest-diff    | 输出 diff，用户确认   |
| workspace-write | 可写允许目录          |
| auto-apply      | loop 中自动应用并验证 |

**MVP 默认：suggest-diff**。D1 决策：MVP Agent 只产出 patch 文本 / diff，用户手动 apply；不实现 workspace-write / auto-apply（Phase 5+）。

Loop 模式下的 workspace-write / auto-apply 同样属于 Phase 5+ 能力，MVP 不启用。

---

## 37. Agent Loop

每轮流程：

```
1. 运行 coverage report
2. policy-engine 过滤字段
3. agent-runtime 生成任务
4. api-ui-agent 计划修复
5. 用户自定义 agent 可参与
6. provider 执行代码修改
7. review-agent 审查 diff
8. build/test/coverage verify
9. 通过则进入下一轮
10. 失败则 rollback
```

伪代码：

```tsx
for (const iteration of loop) {
  const report = await runCoverage()

  const tasks = agentRuntime.createTasks({
    missingRequiredFields: report.missingRequiredFields,
    weakEvidenceFields: report.weakEvidenceFields,
  })

  const results = await agentRuntime.runPlugins(tasks)

  await agentRuntime.review(results)

  const verify = await agentRuntime.verify({
    build: true,
    test: true,
    coverage: true,
    antiCheat: true,
  })

  if (!verify.passed) {
    await agentRuntime.rollback()
    break
  }
}
```

---

## 38. Agent 终止与回滚

配置：

```yaml
agent:
  loop:
    maxIterations: 5
    rollbackOnRegression: true
    stopIfNoImprovementRounds: 2
```

失败场景：

```
构建失败
测试失败
覆盖率下降
新增 suspicious coverage
展示 ignored 字段
UI 截图变化过大
无覆盖率提升
```

处理：

```
回滚本轮修改
记录失败原因
停止或进入人工确认
```

---

## 39. Watch 模式

后续支持：

```bash
npx mk --watch
```

监听：

```
OpenAPI 文件变化
Coverage Policy 变化
DSL 场景变化
插件配置变化
```

增量重跑：

```
OpenAPI 变了 -> regenerate manifest -> reanalyze
DSL 变了 -> rerun scenarios
Policy 变了 -> reanalyze only
```

---

## 40. CI 模式（后置，MVP 不实施）

> **决策依据**：E1/E2 — CI 插件暂不实施。MVP 主打本地开发自检（A2），CI 阻断门后置；roadmap 中不占 Phase。保留本节描述供未来重启参考。

命令（保留设计，未实现）：

```bash
npx mk ci
```

特点：

```
不打开 Dashboard
不交互
不自动写配置
输出 JSON/JUnit
覆盖率不达标 exit 1
```

配置（保留设计，未实现）：

```yaml
ci:
  failOn:
    requiredCoverageBelow: 0.85
    missingRequiredFieldsAbove: 0
    suspiciousCoverageAbove: 0
```

---

## 41. MVP 范围

第一版必须收敛。

### 41.1 MVP 支持

```
React + Vite                          # C3: 后续 Next Client → Vue → 任意 SPA
OpenAPI 3.x
SDK Facade 接入（@mk/client，X1-A）   # C-X1/SDK-CG1-3 已收口：见 5.3
GET 请求
JSON response
字段级 Proxy（SDK Facade 内部行为，见 §19）
Playwright 场景（并发 3，F3）
Coverage Policy
Request Trace
SQLite 存储
Dashboard 报告
Returned but ignored
GET Replay
Agent suggest diff                    # D1：MVP 仅产 diff，不写文件
```

### 41.2 MVP 不支持

```
Vue
Next SSR
GraphQL
POST 自动复现
自动提交代码
复杂 DSL 分支
多浏览器
生产环境采集
完整插件市场
自动编译期注入 data-mk-field
```

---

## 42. Roadmap

### Phase 0：项目骨架，1 周

```
pnpm monorepo
CLI
config loader
kernel plugin
event bus
demo app
```

### Phase 1：Manifest，1-2 周

```
OpenAPI parse
Manifest normalize
fieldId
manifest.json
Manifest Browser
```

### Phase 1.5：SDK Facade Codegen，1-2 周  ← 新增（SDK-CG1/2/3 落地）

```
SDK-CG1：OpenAPI Manifest → typed SDK（@mk/client）
         session 启动时基于 manifest 临时生成 SDK 文件（非提前打包）
SDK-CG2：AST 转换优先的编译期 codegen → 带方法签名/参数/返回值类型的 .ts
         可被 IDE 静态分析 + 自动补全
SDK-CG3：codemod 自动迁移 + fetch monkey-patch fallback
         现有 fetch('/api/...') 扫描 + 替换为 api.xxx.xxx()（`npx mk migrate`）
         已装 @mk/client 但未全量迁移时：mk 也提供 fetch patch fallback，coverage 不丢失
核心指标：demo Hono 后端产出的 OpenAPI → @mk/client typed endpoint 闭环打通
```

### Phase 2：采集，2 周

```
runtime proxy
collector
Playwright runner
request capture
SQLite trace store
UI evidence v0
```

### Phase 3：分析，1-2 周

```
policy-engine
coverage analyzer
ignored returned fields
missing required fields
anti-cheat v0
```

### Phase 4：Dashboard，2 周

```
overview
request list
request detail
field detail
ignored page
GET replay
plugin settings v0
```

### Phase 5：Agent，2-3 周

```
agent-sdk
claude-code provider                # MVP 仅 Claude Code SDK（D2 已定）
suggest diff                        # D1：MVP 不写文件
review guard
loop v0
```

> CI 模式（原 Phase 5.5）已移出 MVP（E1/E2：CI 插件暂不实施）。后置 Phase 视 Phase 0-5 完成后评估是否重启。

### 预计周期

```
最小 demo：3-4 周       # Phase 0 + Phase 1 + Phase 1.5
可用 MVP：8-10 周       # Phase 0-3 + Phase 4 部分
较完整 alpha：12-16 周  # Phase 0-5
```

### 42.5 SDK Codegen 技术要点（Phase 1.5 细化）

> 本节落地 SDK-CG1/CG2/CG3 决策；实现包 `@nx-mk/client/src/codegen/`。

**输入**：OpenAPI Manifest（`@nx-mk/manifest` 产出）

**转换**：
```
manifest.endpoints[] → 按路径分段聚合 → 树形命名空间
  /users/{id}/GET  → api.users.getUser(id)   # operationId 优先；缺失则 method+lastSegment
  /orders/POST     → api.orders.createOrder(...)
```

**产物**（session 启动时写到 `node_modules/.mk/client/`，用户仅 import `@mk/client`）：
```ts
// 自动生成：types.d.ts + endpoints.ts + index.ts
export const api = {
  users: {
    getUser: (id: string) => mkFetch<{ id: string; name: string; ... }>(...)
  }
}
```

**迁移**（SDK-CG3）：
- codemod 扫描 `fetch\(\s*['"`]/api/` → 静态替换为 `api.xxx.yyy()`（可解析路径时）
- 无法静态解析的（动态 URL、自定义 headers）→ 保留原代码 + mk 注入 fetch monkey-patch（fallback，coverage 不断）

**验收**：
- `examples/react-vite-demo` 的 Hono 后端产 OpenAPI → Phase 1 manifest → Phase 1.5 SDK → demo 前端用 `api.users.getUser(1)` 渲染
- coverage.py/report 显示 field-access 命中数与 Playwright UI evidence 一致

---

## 43. 风险与规避

| 风险           | 表现                      | 应对                             |
| -------------- | ------------------------- | -------------------------------- |
| 覆盖率误判     | 字段被读取但未展示        | 区分 access / render / assertion |
| Agent 作弊     | hidden DOM / JSON dump    | evidence quality + anti-cheat    |
| Swagger 不准   | Manifest 与真实返回不一致 | runtime sample + override        |
| Proxy 破坏行为 | 响应式、引用比较异常      | WeakMap 缓存 + plain object only |
| 数据不稳定     | 空值导致覆盖失败          | fixture / HAR / real mode 标注   |
| 报告泄露隐私   | 保存真实响应值            | 默认脱敏                         |
| Loop 失控      | 反复修改无提升            | max iteration + rollback         |
| 字段路径爆炸   | 数组 index 造成大量路径   | path normalizer                  |
| SSR 漏采       | 服务端访问未记录          | 后续支持 server/client 双通道    |
| 生产污染       | 分析代码进入生产包        | X1-A：analysis session-only；SDK 薄壳 1-3KB；tracker 0 字节 |
| SDK adoption 阻力 | 用户需手动装 @mk/client + 改 import | codemod（npx mk migrate）+ fetch monkey-patch fallback + IDE 自动补全降低成本 |

---

## 44. 核心设计原则

### 44.1 分析模式与生产模式解耦

业务代码只依赖稳定 Facade：

```tsx
api.user.getUser()
```

分析能力通过：

```
runtime strategy
middleware pipeline
conditional import
Noop fallback
```

注入。

---

### 44.2 ignored 字段不消失

被 ignored 的字段：

```
不参与有效覆盖率分母
但必须在报告中展示
```

---

### 44.3 每次请求可审计

每一次请求都应该能回答：

```
是谁触发的？
属于哪个场景？
匹配哪个 endpoint？
返回了哪些字段？
字段值是什么状态？
哪些字段被访问？
哪些字段进入 UI？
哪些字段被 ignored？
能不能 replay？
```

---

### 44.4 Agent 不直接追求 100%

Agent 的目标不是无脑覆盖全部字段，而是：

```
在 Coverage Policy 允许范围内
补齐 required / optional missing 字段
避免 ignored 字段
避免 hidden coverage
避免垃圾 UI
```

---

## 45. 最终架构总结

```
OpenAPI / Swagger
      │
      ▼
Swagger Plugin
      │
      ▼
API Manifest
      │
      ├──────────────► Agent Plugin
      │                       │
      │                       ▼
      │                Frontend Diff / DSL Diff
      │
      ▼
Runtime API Client
      │
      ▼
Analysis Mode Proxy
      │
      ├── Field Access Hit
      └── Collector
              │
              ▼
Playwright / CDP
      │
      ├── Request Capture
      ├── Response Field Extract
      ├── UI Evidence Scan
      └── DSL Mapping
              │
              ▼
Request Trace Store
              │
              ▼
Coverage Policy Engine
              │
              ▼
Coverage Analyzer
              │
              ▼
SQLite / Report JSON
              │
              ▼
Dashboard
      │
      ├── Manifest
      ├── Coverage
      ├── Request Detail
      ├── Returned but ignored
      ├── Replay
      ├── Plugin Settings
      └── Agent Loop
```

---

## 46. 一句话结论

`mk` 的最优落地方案是：

> 使用 TypeScript + Node CLI + Playwright + Vite React Dashboard + SQLite + 轻量微内核插件体系，通过 `npx mk` 一键启动本地 API/UI 覆盖率工作台。先把 Manifest、RequestTrace、CoveragePolicy、Dashboard 这四个基础做扎实，再接入 Agent SDK 和 Claude Code Provider，实现可解释、可审计、可复现、可自动补齐的前端 API 覆盖率闭环。

```

```
