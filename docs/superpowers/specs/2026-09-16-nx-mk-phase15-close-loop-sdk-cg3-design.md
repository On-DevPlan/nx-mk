# nx-mk Spec: Phase 1.5 收尾 — Demo 闭环 + SDK-CG3 (migrate codemod + fetch patch)

> 日期：2026-09-16
> 范围：Phase 1.5 剩余交付 —— ① 打通 demo 端到端闭环验收（Plan §42.5）② SDK-CG3（`mk migrate` codemod + fetch monkey-patch fallback）
> 不在范围：Phase 2 采集（runtime proxy tracker 实装、Playwright、collector、SQLite）、Dashboard、Agent、CI 模式
> 关联文档：
> - `docx/plan/nx-mk-plan.md`（Plan §5.3 SDK Facade、§19 字段级 Proxy、§42.5 SDK Codegen 技术要点）
> - `docs/superpowers/specs/2026-08-26-nx-mk-foundation-and-sdk-design.md`（Phase 0/1.5 总 spec）
> - `docs/superpowers/specs/2026-08-27-nx-mk-phase1-manifest-design.md`（Phase 1 spec — parseOpenApi 合约）
> - 参考：`github.com/On-DevPlan/nx-ce`（CLI 薄适配分层 + 零配置默认值模式）

---

## 1. 目标与非目标

### 1.1 现状与缺口

Phase 1.5 的 SDK-CG1/CG2 已交付（`@nx-mk/client` codegen），但存在三个缺口：

1. **parser 丢 named ref**：`parseOpenApi` 对 spec 做 dereference（内联所有 `$ref`），响应 schema 一律标
   `{kind:'object'}`（`parser.ts:106`）。codegen 的 `emit-endpoint.ts:82` 只认 `{kind:'named'}`，于是真
   manifest → codegen 产出全是 `Promise<unknown>`。demo 现有 `generate-sdk.ts` 用**手工构造的 manifest**
   掩盖了这一断点。
2. **SDK-CG3 未实现**：无 `npx mk migrate` codemod，无 fetch monkey-patch fallback（Plan §42.5）。
3. **demo 未闭环**：`app/src/UserProfile.tsx` 用本地手写 `type User` + `as User` 断言 + 本地 Field
   placeholder，未消费 codegen 产物的导出类型与 `@nx-mk/client/react` 真 Field。

### 1.2 目标

本 spec 交付后：

1. `parseOpenApi` 保留响应 / requestBody 的顶层 named schema 引用（含 array-of-named），真 manifest 直接
   可被 codegen 消费产出 `Promise<User>` / `Promise<User[]>` 等类型化返回
2. `@nx-mk/client` 新增 `migrate` 纯函数引擎：扫描 `fetch('/api/...')` 静态调用 → 替换为
   `api.ns.method({...})`，无法静态解析的调用跳过并给出原因
3. `nx-mk migrate` CLI 子命令：薄适配层（读 manifest.json → 扫源码目录 → 调引擎 → 写盘/报告），
   全 flag 有默认值，零配置可跑
4. `@nx-mk/client` 新增 `patchGlobalFetch()` fetch monkey-patch fallback：URL 命中 apiPrefix 时回调
   `onCapture`（Phase 2 collector 接入缝）后委托原 fetch，幂等
5. demo 闭环：`demo:openapi`（server 产 swagger.json）→ `nx-mk run`（plugin-swagger 产
   `.nx-mk/manifest.json`）→ `generate-sdk.ts` 读真 manifest → `app/src/generated-sdk.ts`；
   `UserProfile.tsx` 消费生成的导出类型 + `@nx-mk/client/react` 真 Field
6. 以上全部有 vitest 单测；新增 hermetic 集成测试固化「真实 swagger fixture → parseOpenApi →
   generateSdk → 断言产出签名」全链路

### 1.3 非目标

- Phase 2 tracker / collector 实装 —— `patchGlobalFetch` 只落机制与 `onCapture` 缝，不写事件总线
- codemod 的动态 URL 解析、body/headers/query 参数迁移 —— 一律跳过并报告（交给 fallback），不做 AST 级
  参数重排
- `emit-types` 对嵌套 named ref 的拆分生成 —— 维持现状（Address 内联进 User）
- OpenAPI YAML 输入、多文档合并（Phase 1 已知限制，沿用）
- CLI 配置文件（`nx-mk.config.yml`）新增 migrate 段 —— v0 全走 flag，配置段留待有真实需求再加

### 1.4 成功标准

- `pnpm demo:codegen`（demo 目录语义）在 demo 上跑通完整三段链路，产出的 `app/src/generated-sdk.ts`
  含 `getUser: (params: { id: string }) => Promise<User>` 与 `listUsers: ... => Promise<User[]>`
- `npx nx-mk migrate` 在 demo app 上把静态 `fetch('/api/users/u_001')` 替换为
  `api.users.getUser({ id: 'u_001' })`，报告 skipped 原因，`--dry-run` 不写盘
- 全部测试通过（当前 145 → 预计 +30 上下），`demo:typecheck` 通过
- `UserProfile.tsx` 不再含本地 `type User` 与 `as User` 断言

---

## 2. 仓库架构

### 2.1 目录变化

```
packages/manifest-schema/src/
└── types.ts                          # SchemaRef：{ kind:'array'; items?: SchemaRef }
packages/manifest/src/
└── parser.ts                         # +named ref 提取（raw spec 预扫描）
packages/client/src/
├── codegen/emit-endpoint.ts          # 返回类型 array-of-named；参数类型从 field.type 推导
├── migrate/
│   ├── index.ts                      # 公共导出
│   ├── engine.ts                     # migrateCodemod() 纯函数核心（无 fs）
│   └── __tests__/engine.test.ts
├── runtime/
│   ├── patch.ts                      # patchGlobalFetch()
│   └── __tests__/patch.test.ts
└── package.json                      # +typescript（devDep → dep，codemod 运行时需要）
packages/cli/src/
├── commands/migrate.ts               # mk migrate 薄适配
├── __tests__/migrate.test.ts
└── index.ts                          # Subcommand + HELP + dispatch 扩展
examples/react-vite-demo/
├── nx-mk.config.yml                  # ← 由 mk.config.yml 改名（findConfigFile 只认 nx-mk.config.*）
├── generate-sdk.ts                   # 删手写 manifest，改读 .nx-mk/manifest.json
├── app/src/UserProfile.tsx           # 删本地类型/断言/Field placeholder
└── README.md                         # 运行步骤
tests/
└── ...                               # hermetic 集成测试 + 固化的 demo swagger fixture
```

### 2.2 依赖变化

- `@nx-mk/client`：`typescript` 从 devDep 移到 dep（migrate 引擎运行时依赖 TS Compiler API）
- `@nx-mk/cli`：+`@nx-mk/client`（workspace:*，migrate 命令调用引擎）；无循环依赖
  （client → manifest-schema，cli → kernel/config/client）

---

## 3. 组件职责

### 3.1 SchemaRef 类型扩展（`@nx-mk/manifest-schema`）

```ts
// 现状
| { kind: 'array' }
// 改为
| { kind: 'array'; items?: SchemaRef }
```

纯类型扩展，向后兼容（现有 `{kind:'array'}` 字面量仍然合法）。

### 3.2 parser named-ref 提取（`@nx-mk/manifest`）

`parseOpenApi` 内新增**raw spec 预扫描**（dereference 前 raw JSON 已在手上）：

- 对每个 operation：
  - 响应：`responses[status].content['application/json'].schema`
  - 请求体：`requestBody.content['application/json'].schema`
- 提取规则（只看顶层，不递归）：
  - `schema.$ref` 存在 → `{ kind:'named', name: <RFC6901 反逃逸后的末段> }`
    （`#/components/schemas/User` → `User`）
  - `schema.type === 'array'` → `{ kind:'array', items: items.$ref ? {kind:'named', name} : undefined }`
  - 其余 → 维持现状 `{ kind:'object' }`（无 schema 时 `undefined`）
- dereference 后的字段行走（schema-walker）不受影响

### 3.3 codegen 返回类型与参数类型（`@nx-mk/client`）

`emit-endpoint.ts`：

- 返回类型：`named → name`；`array + items.kind==='named' → \`${name}[]\``；其余 `unknown`
- path/query 参数类型：从 `ApiField.type` 推导 —— `string→string`、`number/integer→number`、
  `boolean→boolean`，其余 `unknown`（替代现在硬编码 `unknown`）
- 命名空间 / 方法名继续走 `deriveNamespace` / `deriveMethodName`（已导出）—— **codemod 与 codegen
  同源取名，禁止漂移**

### 3.4 migrate 引擎（`@nx-mk/client/migrate`，纯函数）

```ts
interface MigrateCodemodInput {
  manifest: ApiManifest
  files: { path: string; content: string }[]   // IO 由调用方（CLI）完成
  apiPrefix?: string                           // 默认 '/api'
  importSpecifier?: string                     // 默认 './generated-sdk'
}
interface MigrateCodemodResult {
  files: { path: string; content: string; changed: boolean }[]
  report: {
    replaced: { path: string; from: string; to: string }[]
    skipped: { path: string; fetch: string; reason: string }[]
  }
}
function migrateCodemod(input: MigrateCodemodInput): MigrateCodemodResult
```

匹配与替换规则（TS Compiler API，`ts.createSourceFile` 逐文件）：

1. 找 `fetch` 标识符的 CallExpression；首参为 `StringLiteral` / `NoSubstitutionTemplateLiteral`
2. 值以 `apiPrefix` 开头（其后紧跟 `/`），否则跳过（reason: `outside api prefix`）
3. 剥前缀后与 endpoint `path` 模板做段匹配：段数相等，模板无参段必须字面相等，`{param}` 段捕获值；
   含 `?` query 或含替换的模板字符串 → 跳过（reason 分别 `query in url` / `dynamic url`）
4. 第二参缺省 → GET；`ObjectLiteral` 且仅含 `method` 字符串字面量 → 采用；含其他属性
   （body/headers/…）→ 跳过（reason: `request init not supported`）
5. method+path 查 manifest endpoints（无 operationId 时派生名走同一 derive 函数）；无匹配 → 跳过
   （reason: `no endpoint match`）
6. 替换：`api.ns.method()`（无路径参数）或 `api.ns.method({ id: 'u_001', ... })`；
   用 CallExpression 文本 span 做安全替换
7. 文件内替换 ≥1 处且缺 import 时，插入 `import { api } from '<importSpecifier>'`
   （按 specifier 去重，插到现有 import 块之后）

### 3.5 fetch monkey-patch fallback（`@nx-mk/client/runtime`）

```ts
function patchGlobalFetch(options?: {
  apiPrefix?: string            // 默认 '/api'
  onCapture?: (info: { method: string; url: string }) => void
}): () => void                 // 返回 unpatch
```

- 包裹 `globalThis.fetch`：解析 url（string / URL / Request 三形态）与 method，path 命中 apiPrefix
  时先调 `onCapture` 再委托**原** fetch
- 幂等：已 patch 时再次调用直接返回 no-op unpatch，不叠加包裹
- `globalThis.fetch` 不存在 → 返回 no-op unpatch（不抛错）

### 3.6 CLI `mk migrate`（`@nx-mk/cli`，薄适配）

| Flag | 默认 | 说明 |
|---|---|---|
| `--manifest <path>` | `.nx-mk/manifest.json` | manifest 来源 |
| `--dir <path>` | `./src` | 扫描目录（递归，ts/tsx/js/jsx，跳过 node_modules/dist） |
| `--api-prefix <p>` | `/api` | fetch URL 前缀 |
| `--import <specifier>` | `./generated-sdk` | 插入的 api import 来源 |
| `--dry-run` | off | 只报告不写盘 |
| `--json` | off | 机器可读报告输出 |

- 行为：读 manifest（JSON.parse + 最小形状校验：`endpoints` 数组存在）→ 读文件 → 引擎 → 非 dry-run
  写回 changed 文件 → 人类可读摘要（replaced/skipped 计数与明细；`--json` 时输出完整 report）
- 退出码：成功（含 skipped）0；manifest 缺失 → `KernelError('CONFIG_NOT_FOUND')`（提示先跑
  `nx-mk run`）；manifest 非法 JSON / 形状不符 → `CONFIG_INVALID`；其余沿 CLI 顶层 catch

### 3.7 demo 闭环（`examples/react-vite-demo`）

1. `mk.config.yml` → 改名 `nx-mk.config.yml`（内容微调注释）
2. `generate-sdk.ts`：删手写 manifest；`readFileSync('.nx-mk/manifest.json')` → `generateSdk(manifest,
   { baseUrl: '/api' })` → 写 `app/src/generated-sdk.ts`（写入路径不变）
3. 根 `package.json` 的 `demo:codegen` 串真链路：`demo:openapi`（server 产 swagger.json）→ 构建 cli →
   **在 demo 目录**跑 `nx-mk run`（plugin-swagger 产 `.nx-mk/manifest.json`）→ `tsx generate-sdk.ts`
4. `UserProfile.tsx`：`import { api, type User } from './generated-sdk.js'`；删本地 `type User`、
   `as User`；本地 Field placeholder 换 `import { Field } from '@nx-mk/client/react'`（签名相同）
5. demo README 补三步运行说明（openapi → run → codegen；migrate 演示可选）

---

## 4. 错误处理（fail-fast）

| 场景 | 处理 |
|---|---|
| migrate：manifest 文件不存在 | `KernelError('CONFIG_NOT_FOUND')`，消息提示先跑 `nx-mk run` |
| migrate：manifest JSON 非法或缺 `endpoints` | `KernelError('CONFIG_INVALID')` |
| migrate：`--dir` 不存在 | `KernelError('CONFIG_NOT_FOUND')` |
| engine：单个 fetch 无法静态解析 | **不抛错** —— 记入 `report.skipped`，继续处理 |
| patchGlobalFetch：环境无 fetch | 返回 no-op unpatch，不抛错 |
| parser：raw spec 的 `$ref` 形态异常（非 `#/components/schemas/...`） | 降级为现有 `{kind:'object'}`，不抛错 |

---

## 5. 数据流（闭环全景）

```
demo/server (Hono + zod-openapi)
  └─ pnpm demo:openapi ──→ swagger/openapi.json
        └─ nx-mk run（plugin-swagger beforeRun）
              └─ parseOpenApi：dereference + named-ref 预扫描
                    └─ .nx-mk/manifest.json   ← 真 manifest（named refs 在手）
                          └─ generate-sdk.ts ── generateSdk() ──→ app/src/generated-sdk.ts
                                └─ UserProfile.tsx：api.users.getUser({id}) → Promise<User>
                                      └─ <Field field="user.profile.name">（@nx-mk/client/react）

并行路径（存量代码迁移）：
  旧代码 fetch('/api/users/u_001')
    └─ npx nx-mk migrate ──→ api.users.getUser({ id: 'u_001' }) + 自动 import
    └─ 无法静态解析的调用 ──→ patchGlobalFetch() 兜底（Phase 2 collector 接 onCapture）
```

---

## 6. 测试策略

全部 vitest 单测（沿用各包现有 `__tests__` 布局），TDD 推进：

| 层 | 用例要点 |
|---|---|
| parser（`packages/manifest`） | `$ref` 响应 → named；`array + items.$ref` → array+items；requestBody `$ref` → named；inline 响应维持 object；RFC6901 转义名 |
| codegen（`packages/client`） | `Promise<User>`；`Promise<User[]>`；参数 `{ id: string }`（number→number）；无 operationId 派生名与 codemod 一致 |
| migrate engine（`packages/client`） | 命中替换（GET/POST、0/1/N 参数）；query/dynamic/init/no-match 四类 skip；import 插入与去重；同文件多处替换；不改未命中文件 |
| patchGlobalFetch（`packages/client`） | 命中回调 + 委托原 fetch；未命中不回调；幂等；无 fetch 环境；unpatch 还原 |
| CLI migrate（`packages/cli`） | 临时 fixture 项目：全流程替换、dry-run 不写盘、manifest 缺失 exit 2、`--json` 输出 |
| 集成（`tests/`，hermetic） | 固化 demo swagger fixture → `parseOpenApi` → `generateSdk` → 断言产出含 `Promise<User>` / `listUsers → User[]`；engine 跑 demo 同形 fixture 断言替换文本 |

计数基线：145 → 预计 +30±10，全部通过。

---

## 7. 决策摘要

| # | 决策 | 理由 |
|---|---|---|
| D1 | codemod 用 TS Compiler API（非正则） | 用户已确认；模板字符串/多行/嵌套括号下正则脆弱；typescript 已在 workspace，仅 devDep→dep |
| D2 | 支持 array-of-named（`items?: SchemaRef`） | 用户已确认；demo `GET /users → User[]` 是 typed SDK 的完整展示；改动三处各几行 |
| D3 | 引擎纯函数（IO 在 CLI），参考 nx-ce 分层 | 核心可独立单测；CLI 保持薄适配；与 nx-ce 的 bin→parser→commands→core 模式一致 |
| D4 | codemod 取名复用 codegen 的 derive 函数 | 单一来源，替换产名与 codegen 产物必然一致 |
| D5 | CLI flag 全默认值，零配置可跑（nx-ce 式） | `npx nx-mk migrate` 开箱即用；配置段 YAGNI |
| D6 | demo config 改名 `nx-mk.config.yml` | `findConfigFile` 只认 `nx-mk.config.{yml,yaml}`；不改则闭环依赖 `--config` flag |
| D7 | migrate 错误复用 `CONFIG_NOT_FOUND`/`CONFIG_INVALID` | 语义贴切（输入文件类），避免为 migrate 动 kernel 的 ErrorCode |
| D8 | fetch fallback v0 只落 `onCapture` 缝 | coverage 采集是 Phase 2；现在只保证机制与接入点存在（Plan：coverage 不丢失的前置） |

---

## 8. 风险与未来扩展点

| 风险 | 缓解 |
|---|---|
| `typescript` 进 client 运行时依赖，包体积增大 | 仅 migrate 路径 import（动态 import 可选优化）；client 主入口/runtime 不引入 |
| zod-openapi 对 nullable 输出形态与 emit-types 假设不符 | 集成测试用**真实 swagger fixture** 固化形态，跑通即锁死 |
| codemod 误替换（用户自己的 fetch 语义与 endpoint 不同） | 仅静态字面量 + 段匹配才替换；`--dry-run` 先行；报告列出每处替换 |
| parseOpenApi 预扫描与 dereference 的 operation 对位错位 | 按 path+method key 取 raw operation，与 deref 循环同 key 源，单测覆盖 |

扩展点：Phase 2 在 `onCapture` 缝接 collector；migrate 配置段（`migrate:` in config）后置；嵌套 named
类型拆分生成（`Address` 独立 interface）后置。

---

## 9. 自检

- [x] 无 TBD/占位段
- [x] 与 Plan §42.5 验收标准逐条对应（闭环：§1.2-5 / §5；CG3 codemod：§3.4；CG3 fallback：§3.5）
- [x] 与 Phase 1 spec 的 `parseOpenApi` 合约兼容（纯增强，现有调用方不受影响）
- [x] 范围单一（一个实施计划可承载），非目标明确
- [x] 错误路径均有归属（fail-fast 表 + engine skip 语义）
