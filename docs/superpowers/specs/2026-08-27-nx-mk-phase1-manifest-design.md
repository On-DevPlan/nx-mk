# nx-mk Spec: Phase 1 — Manifest (OpenAPI → Manifest)

> 日期：2026-08-27
> 范围：Phase 1 — OpenAPI 解析 + Manifest 生成
> 不在范围：Phase 2+ SDK Facade、字段代理、Playwright 采集、Dashboard、Agent
> 关联文档：
> - `docx/plan/nx-mk-plan.md`（Plan §16 Manifest schema、§17 路径归一化、§42 Phase 1 roadmap）
> - `docs/superpowers/specs/2026-08-26-nx-mk-phase0-foundation-design.md`（Phase 0 spec — 内核接口、PluginContext 合约）

---

## 1. 目标与非目标

### 1.1 目标

本 spec 交付后：

1. `nx-mk.config.yml` 可选地声明 `openapi: <path>` 字段，指向 OpenAPI 3.0/3.1 文档
2. `@nx-mk/manifest` 包导出 `parseOpenApi(specPath, options): Promise<Manifest>` 纯函数
3. `@nx-mk/plugin-swagger` 的 `run` hook 在 `nx-mk run` 期间调用 `parseOpenApi`，写入项目根的 `.nx-mk/manifest.json`
4. 生成的 `manifest.json` 符合 Plan §16 的 `ApiManifest` 类型（version / source / generatedAt / endpoints / schemas / fields）
5. 字段 ID 满足 §16.4 稳定哈希规范（同一 OpenAPI → 同一 ID；不同 OpenAPI → 不同 ID）
6. 路径归一化按 §17（数组下标 → `[]`）
7. 59/59 → 新的 unit + integration 测试；CLI E2E 增加 manifest 断言

### 1.2 非目标（明确不在 Phase 1 范围）

- Phase 2 字段代理（§19）—— 仅在 manifest 生成，**不记录实际字段访问**
- Phase 2 Playwright/CDP 请求捕获
- Phase 2 UI Evidence 采集
- Phase 2 Collector / SQLite trace store
- Manifest Browser UI（DASHBOARD）—— Phase 4 / SPEC #2
- 多 OpenAPI 文档合并（Phase 1 单源）
- OpenAPI 2.0 → 3.0 自动升级（用户须提供 3.x）
- GraphQL / tRPC / 内部 RPC 输入（Plan §41.2 MVP 不支持）

### 1.3 成功标准

- `nx-mk run` 在含 `openapi:./swagger.json` 的项目里产出 `.nx-mk/manifest.json`，内容满足 Plan §16 schema
- 同一 OpenAPI 两次运行生成**字节级相同**的 manifest.json（哈希稳定）
- 不含 `openapi:` 的项目跑 `nx-mk run` 不报错、exit 0、不产生 manifest.json
- OpenAPI 源文件不存在或不合规 → plugin-swagger 的 run hook 抛 `KernelError(PLUGIN_HOOK_FAILED)`，exit 4
- 全部 59 → ≥63 个 unit 测试通过
- CLI E2E 增加 1 个断言：`.nx-mk/manifest.json` 存在且含 `version` 字段

---

## 2. 仓库架构

### 2.1 目录变化

```
packages/
├── manifest/                        # ← 实做（当前是占位）
│   ├── package.json                  # +@apidevtools/swagger-parser
│   ├── tsconfig.json                 # 已存在
│   ├── tsup.config.ts                # 已存在
│   └── src/
│       ├── index.ts                  # 重导出公共 API
│       ├── parser.ts                 # parseOpenApi() — 主入口
│       ├── normalizer.ts             # 路径归一化（§17）
│       ├── field-id.ts               # stableFieldId()（§16.4）
│       ├── schema-walker.ts          # 内部：OpenAPI Schema 递归遍历
│       └── __tests__/
│           ├── parser.test.ts        # fixture swagger.json + 断言
│           ├── normalizer.test.ts    # 数组下标 → []
│           └── field-id.test.ts      # 稳定性 + 唯一性
└── plugin-swagger/                   # ← 替换占位
    └── src/
        └── index.ts                  # createSwaggerPlugin(): Plugin — run hook 实做
```

**不修改**：`@nx-mk/kernel`、`@nx-mk/config`、`@nx-mk/cli`、`@nx-mk/manifest/tsup.config.ts`（已存在）。

### 2.2 依赖变化

`packages/manifest/package.json` 新增：

```json
"dependencies": {
  "@apidevtools/swagger-parser": "^10.1.0"
}
```

`pnpm install` 后解析；锁定到兼容版本（实际装时确定）。

### 2.3 包依赖图

```
plugin-swagger ──depends on──> kernel (peer + dev) + manifest (peer + dev)
manifest ──depends on──> (nothing — 纯 leaf 包)
manifest ──peer──> kernel (类型导入但不运行时引用)
```

manifest 只需要 `@apidevtools/swagger-parser` 一个运行时依赖 + 共享 `yaml` 类型（可选）。

---

## 3. Manifest 类型（来自 Plan §16.1-16.4，复用）

```ts
// @nx-mk/manifest/src/index.ts 重导出：

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export interface ApiField {
  id: string                                // stableFieldId(...)
  endpointId: string                        // 所属 endpoint 的 id
  direction: 'request' | 'response'
  status?: string                           // 仅 response 有
  path: string                              // 原始字段路径
  normalizedPath: string                    // 归一化后的路径
  name: string
  type: string
  required?: boolean
  nullable?: boolean
  description?: string
  example?: unknown
  enum?: string[]
  schemaName?: string                       // 引用的 components.schemas 名称
  source: { openapiPointer: string }        // JSON Pointer 到 OpenAPI 文档原位置
}

export interface ApiEndpoint {
  id: string                                // stableFieldId(method:path:response:status)
  method: HttpMethod
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

export type SchemaRef =
  | { kind: 'named'; name: string }
  | { kind: 'inline'; schema: unknown }
  | { kind: 'array'; items: SchemaRef }
  | { kind: 'object'; properties: Record<string, SchemaRef> }
  | { kind: 'primitive'; type: string }

export interface ApiManifest {
  version: string                          // '1'
  source: {
    type: 'openapi'
    input: string                           // OpenAPI 源路径
    hash: string                            // 源文件 sha1 前 16 hex
  }
  generatedAt: string                       // ISO 8601
  endpoints: ApiEndpoint[]
  schemas: Record<string, ApiSchema>        // 暂存：flat 后的 schema 表
  fields: ApiField[]                        // 所有 endpoint 的全部 fields 展平
}
```

---

## 4. 组件职责

### 4.1 `parser.ts` —— 主入口

```ts
export interface ParseOptions {
  cwd?: string                             // 默认 process.cwd()
}

export async function parseOpenApi(
  specPath: string,
  options: ParseOptions = {}
): Promise<ApiManifest>
```

**流程：**
1. `readFileSync(path)` 读 YAML 或 JSON
2. `SwaggerParser.parse(raw)` 解引用所有 `$ref` → 完整 OpenAPI 对象
3. `walkEndpoints(spec)` → 遍历 `paths` → `ApiEndpoint[]`
4. `walkSchemas(spec)` → 从 `components.schemas` → `ApiSchema[]`
5. `fieldId` + `normalizePath` 处理
6. 构造 `ApiManifest` 并返回

### 4.2 `normalizer.ts` —— 路径归一化（Plan §17）

```ts
export function normalizePath(p: string): string
```

**规则：**
- `orders.0.items.2.skuName` → `orders[].items[].skuName`
- `data.0.user.id` → `data[].user.id`
- `data.user.name` → `data.user.name`（不动）
- `data` → `data`（不动）
- `[]` 放在每个数字段后面

### 4.3 `field-id.ts` —— 稳定哈希（Plan §16.4）

```ts
export interface FieldIdInput {
  method: HttpMethod
  path: string                              // `/users/{id}` 模板路径，不是实例路径
  direction: 'request' | 'response'
  status?: string                            // 仅 response
  normalizedFieldPath: string
}

export function stableFieldId(input: FieldIdInput): string
```

**算法：**
```ts
const rawKey = `${input.method}:${input.path}:${input.direction}:${input.status ?? ''}:${input.normalizedFieldPath}`
return createHash('sha1').update(rawKey).digest('hex').slice(0, 12)
```

**endpointId 用同一算法但省略 `direction/status/normalizedFieldPath`：**
```ts
const rawKey = `${input.method}:${input.path}`
return createHash('sha1').update(rawKey).digest('hex').slice(0, 12)
```

### 4.4 `schema-walker.ts` —— Schema 递归遍历

**输入：** 已解引用的 OpenAPI Schema 对象 + endpointId + direction + status
**输出：** `ApiField[]`（每个字段一条记录）

**规则：**
- `type: 'object'` → 递归 `properties`，field 名取 key
- `type: 'array'` → 递归 `items`，字段 path 加 `[]` 后缀
- `type: 'string' / 'number' / 'boolean' / 'integer'` → 终止，产出 primitive field
- `allOf` → 合并所有 schema
- `oneOf` / `anyOf` → 递归每个 variant，path 加 `(oneOf[0])` / `(anyOf[0])` 后缀
- `$ref` 在 swagger-parser 解引用后已展开；无需单独处理
- `nullable: true` → 字段 `nullable: true`

**field.path 构造：**
- 顶层字段：`data` (response body 通常包裹在 data 里；Phase 1 不做自动包裹，直接用 schema 名)
- 嵌套字段：`parent.child.grandchild`
- 数组元素：`items[]`
- oneOf 分支：`fieldName(oneOf[0])`

**field.normalizedPath：** 同 path，但数字下标替换为 `[]`

---

## 5. plugin-swagger 集成

### 5.1 当前占位 → 实做

**当前 `packages/plugin-swagger/src/index.ts`：**

```ts
hooks: {
  async beforeResolvePlugins(ctx) { ctx.logger.info('...registered...') },
  async run(ctx) { ctx.logger.info('...run noop...') },  // ← 占位
}
```

**实做后：**

```ts
hooks: {
  async beforeResolvePlugins(ctx) { /* same as before */ },
  async run(ctx) {
    const cmd = ctx.kernel.getSubcommand()
    // 仅 run / doctor 子命令触发 manifest 生成；init 不生成（避免 init 阶段副作用）
    if (cmd !== 'run' && cmd !== 'doctor') return

    const specPath = ctx.config.openapi
    if (!specPath) {
      ctx.logger.info({ cmd }, 'plugin-swagger: no openapi configured, skipping manifest generation')
      return
    }

    const resolvedSpecPath = isAbsolute(specPath)
      ? specPath
      : join(ctx.config.configPath ? dirname(ctx.config.configPath) : ctx.cwd, specPath)

    const manifest = await parseOpenApi(resolvedSpecPath, { cwd: ctx.cwd })
    const manifestPath = join(ctx.cwd, '.nx-mk', 'manifest.json')
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    ctx.logger.info({
      specPath: resolvedSpecPath,
      manifestPath,
      endpoints: manifest.endpoints.length,
      fields: manifest.fields.length,
    }, 'plugin-swagger: manifest generated')
  },
}
```

**注意：** 当前 `PluginContext` 里没有 `cwd` 字段 —— Phase 1 需要在 `PluginContext` 增加 `cwd: string` 字段（值 = `createKernel` 的 `cwd`）。这是对 Phase 0 的 1 行扩展。

### 5.2 触发条件（fail-fast）

| `config.openapi` | 子命令 | 行为 |
|---|---|---|
| 未配置 | 任意 | 跳过 manifest 生成，`ctx.logger.info` 一行 |
| 配置 | `init` | 跳过（init 是脚手架，不该解析 OpenAPI）|
| 配置 | `run` / `doctor` | **生成 manifest.json**；任何错误 fail-fast |
| 文件不存在 | `run` / `doctor` | plugin-swagger 抛 `KernelError(PLUGIN_HOOK_FAILED)` → `nx-mk run` exit 4 |
| 文件不合规 / $ref 断 | `run` / `doctor` | 同上 fail-fast |

### 5.3 PluginContext 扩展（Phase 0 → Phase 1 的唯一接口变更）

`packages/kernel/src/plugin.ts:48-53` 增加 `cwd` 字段：

```ts
export interface PluginContext {
  config: ResolvedConfig
  logger: Logger
  events: EventBus
  kernel: KernelAPI
  cwd: string                    // ← 新增：内核运行的工作目录
}
```

`packages/kernel/src/kernel.ts:210-213` 的 `buildCtx()` 注入：

```ts
function buildCtx(): PluginContext {
  // ... (placeholder logic unchanged)
  return { config: placeholder, logger, events, kernel: api, cwd }  // ← 加 cwd
}
```

**这是 Phase 0 spec 的扩展，但属于"追加字段"而非"破坏性变更"**（Phase 0 插件用解构访问 `{ config, logger, events, kernel }`，新增字段不破坏）。

---

## 6. 错误处理（fail-fast）

| 错误源 | 包装 | 退出码 |
|---|---|---|
| 文件不存在 (`fs.readFileSync` ENOENT) | `KernelError('PLUGIN_HOOK_FAILED', ...)` | 4 |
| YAML/JSON 解析失败 | 同上 | 4 |
| OpenAPI schema 不合规（`swagger-parser` 抛 ValidationError） | 同上 | 4 |
| `$ref` 解析失败（dereference 失败） | 同上 | 4 |
| 写 manifest.json 失败（权限 / 磁盘满） | 同上 | 4 |
| `openapi:` 路径配置不存在 | 同上 | 4 |

**理由（已与用户确认）：** 任何 OpenAPI 源问题应立即可见，不留"半成品 manifest"。

---

## 7. 数据流

```
[config.openapi: "./swagger.json"]
   │
   │ Phase 4: run hook
   ▼
[plugin-swagger 读取 ctx.config.openapi]
   │
   │ resolve relative path against ctx.cwd
   ▼
[abs path = e.g. /abs/path/to/swagger.json]
   │
   │ await parseOpenApi(absPath, { cwd })
   ▼
[@nx-mk/manifest]
   1. readFileSync(raw)
   2. SwaggerParser.parse(raw)  → dereferenced OpenAPI obj
   3. walkEndpoints()            → ApiEndpoint[]
   4. walkSchemas()              → ApiSchema[]
   5. for each field: normalizePath + stableFieldId
   6. return ApiManifest
   │
   ▼
[plugin-swagger]
   writeFileSync(.nx-mk/manifest.json, JSON.stringify(manifest, null, 2))
   │
   │ ctx.logger.info({ endpoints, fields })
   ▼
[nx-mk run pipeline]
   ✔ Generate manifest    128 endpoints / 1,246 fields  ← Plan §3 UX
```

---

## 8. 测试策略

### 8.1 Unit 测试（`@nx-mk/manifest`）

**`parser.test.ts`** —— 用 fixture swagger.json（含 paths / components / $ref）：

```ts
test('parses minimal OpenAPI 3 spec with 2 endpoints', async () => {
  const fixture = join(fixturesDir, 'minimal-openapi.json')
  const manifest = await parseOpenApi(fixture)
  expect(manifest.endpoints).toHaveLength(2)
  expect(manifest.endpoints[0]).toMatchObject({
    method: 'GET',
    path: '/users/{id}',
  })
  expect(manifest.source.hash).toHaveLength(16) // sha1 hex
  expect(manifest.source.input).toContain('minimal-openapi')
})

test('derefences $ref pointers in components', async () => {
  const fixture = join(fixturesDir, 'with-refs.json')
  const manifest = await parseOpenApi(fixture)
  expect(manifest.fields.some(f => f.name === 'userName')).toBe(true)
})

test('throws KernelError when file does not exist', async () => {
  await expect(parseOpenApi('/nonexistent.json')).rejects.toMatchObject({
    code: 'PLUGIN_HOOK_FAILED',
  })
})
```

**`normalizer.test.ts`：**

```ts
test('array indices become []', () => {
  expect(normalizePath('orders.0.items.2.skuName')).toBe('orders[].items[].skuName')
  expect(normalizePath('data.0.user.id')).toBe('data[].user.id')
})
test('non-array paths unchanged', () => {
  expect(normalizePath('data.user.name')).toBe('data.user.name')
})
```

**`field-id.test.ts`：**

```ts
test('same input produces same id', () => {
  const input = { method: 'GET', path: '/users', direction: 'response', status: '200', normalizedFieldPath: 'data.id' }
  expect(stableFieldId(input)).toBe(stableFieldId(input))
})
test('different inputs produce different ids', () => {
  const a = { method: 'GET', path: '/users', direction: 'response', status: '200', normalizedFieldPath: 'data.id' }
  const b = { ...a, method: 'POST' }
  expect(stableFieldId(a)).not.toBe(stableFieldId(b))
})
test('id is 12 hex characters', () => {
  expect(stableFieldId({ method: 'GET', path: '/x', direction: 'request', normalizedFieldPath: 'a' })).toMatch(/^[0-9a-f]{12}$/)
})
```

### 8.2 Integration 测试（plugin-swagger end-to-end）

**`plugin-swagger/src/__tests__/index.test.ts`：**

```ts
test('run hook calls parseOpenApi and writes manifest.json', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'plugin-swagger-'))
  writeFileSync(join(tmpDir, 'swagger.json'), FIXTURE_OPENAPI)
  const plugin = createSwaggerPlugin()
  
  // 构造 PluginContext（mock）
  const ctx = makeMockCtx({ cwd: tmpDir, config: { openapi: './swagger.json', ... } })
  await plugin.hooks.run(ctx)
  
  const manifestPath = join(tmpDir, '.nx-mk', 'manifest.json')
  expect(existsSync(manifestPath)).toBe(true)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  expect(manifest.endpoints.length).toBeGreaterThan(0)
})

test('skips silently when openapi not configured', async () => {
  const ctx = makeMockCtx({ cwd: tmpDir, config: { /* no openapi */ } })
  await plugin.hooks.run(ctx)  // should NOT throw
  expect(existsSync(join(tmpDir, '.nx-mk', 'manifest.json'))).toBe(false)
})

test('throws when openapi file missing', async () => {
  const ctx = makeMockCtx({ cwd: tmpDir, config: { openapi: './missing.json' } })
  await expect(plugin.hooks.run(ctx)).rejects.toBeInstanceOf(KernelError)
})
```

### 8.3 E2E 测试（CLI）

**新增 `tests/e2e/phase1-manifest.test.sh`：**

```bash
TMP=$(mktemp -d)
cd $TMP
# init config with openapi
cat > nx-mk.config.yml <<EOF
openapi: ./swagger.json
plugins:
  - '@nx-mk/plugin-swagger'
EOF
# write fixture swagger
cp $FIXTURES/minimal.json ./swagger.json
# run
node $REPO/packages/cli/dist/index.js run
# assert
test -f .nx-mk/manifest.json
test "$(jq '.endpoints | length' .nx-mk/manifest.json)" -gt 0
```

---

## 9. 决策摘要

| # | 决策 | 选择 | 原因 |
|---|---|---|---|
| 1 | OpenAPI 来源 | `nx-mk.config.yml` 的 `openapi:` 字段 | 与 PluginContext 一致；plugin-swagger 与 Phase 2 SDK 共享 |
| 2 | Manifest 输出路径 | `.nx-mk/manifest.json`（项目级全局）| 调试简单；Phase 2 加 per-run 拷贝可后续做 |
| 3 | OpenAPI 解析库 | `@apidevtools/swagger-parser` | 业界最成熟；Plan 未指定 |
| 4 | 触发方式 | `nx-mk run` / `nx-mk doctor` 期间 plugin-swagger 自动生成；`init` 跳过 | 对齐 Plan §3 UX；不引入单独 CLI 子命令 |
| 5 | 错误策略 | fail-fast（任何错误 exit 4）| 不留半成品 manifest 状态；中间状态立即可见 |
| 6 | fieldId 算法 | sha1 → 12 hex chars | 简短、Plan 推荐；同输入 → 同输出 |
| 7 | PluginContext 扩展 | 新增 `cwd: string` 字段 | 插件需要知道 manifest 写到哪里 |
| 8 | Plugin hook 时机 | `run`（不抢 `beforeResolvePlugins`）| Plugin "main work" 时机；与 Plan §3 一致 |
| 9 | 错误时的 manifest 状态 | 不写部分 manifest（fail-fast 中断）| 一致性：要么完整、要么没有 |

---

## 10. 风险与未来扩展点

### 10.1 Phase 1 已知风险

| 风险 | 缓解 |
|---|---|
| `@apidevtools/swagger-parser` 是个大依赖 | 接受：Phase 1 优先可靠性；未来可换轻量解析 |
| OpenAPI 3.2 兼容性 | 依赖 swagger-parser 自动跟随；Phase 1 接受 OpenAPI 3.0 / 3.1 |
| fixture swagger.json 维护 | 测试 fixture 在 `packages/manifest/src/__tests__/fixtures/` 提交到 git；维护者加新字段测试时更新 fixture |
| `cwd` 字段加到 PluginContext | Phase 0 插件用解构 `const { config, logger, events, kernel } = ctx` 不破坏；但需更新 Phase 0 spec |
| Phase 2 字段代理会冲突 | Phase 1 manifest 不含运行时数据；Phase 2 的 proxy 读 manifest.json 后注入到用户应用；不冲突 |

### 10.2 Phase 2+ 待解决（不在 Phase 1）

- Manifest 是否需要 per-run 拷贝（Phase 2 报告引用）
- 字段代理（Plan §19）
- 多个 OpenAPI 文档合并
- OpenAPI 2.0 支持（用户升级到 3.x）
- `plugin-swagger` 的更复杂钩子（auth 注入、错误处理）

---

## 11. 自检

撰写完成后逐项检查：

- [x] 无 placeholder / TODO / TBD（除明确标记的 Phase 2+ 字段）
- [x] Manifest 类型与 Plan §16.1-16.4 完全对齐
- [x] `cwd` 字段是 PluginContext 的唯一扩展，向后兼容
- [x] 错误策略（fail-fast）与已确认用户选择一致
- [x] 触发时机与 Plan §3 愿景一致（plugin-swagger run hook）
- [x] 测试策略覆盖 unit + integration + E2E 三层
- [x] 决策摘要表完整列出 9 项决策
- [x] Phase 0 接口未被破坏性修改
