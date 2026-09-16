# Phase 1.5 闭环 + SDK-CG3 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 demo 端到端闭环（server OpenAPI → parseOpenApi named refs → manifest.json → generateSdk → app typed SDK）并交付 SDK-CG3（`mk migrate` codemod + `patchGlobalFetch` fallback）。

**Architecture:** 四层增量 —— ① parser 预扫描 raw spec 保留 named schema refs（codegen 可用的前提）；② `@nx-mk/client` 新增 migrate 纯函数引擎（TS Compiler API，文件 IO 留给 CLI）与 `patchGlobalFetch` 运行时；③ CLI `migrate` 薄适配子命令；④ demo 消费真链路产物（config 改名、UserProfile 换真类型/真 Field）。

**Tech Stack:** TypeScript 5.3 + TS Compiler API（codemod）、vitest 1.6、pnpm workspace（v9，经 corepack）、tsup。

**Spec:** `docs/superpowers/specs/2026-09-16-nx-mk-phase15-close-loop-sdk-cg3-design.md`（实施时与 spec 一起读；本计划按 spec §3.1–§3.7 逐组件落地）

## Global Constraints

- **环境**：Windows + Git Bash。全局 pnpm 是 8.15.9，被 `engines.pnpm >=9` 拒绝 —— **所有 pnpm 命令一律用 `corepack pnpm`**（如 `corepack pnpm --filter @nx-mk/client build`）；vitest/tsc 直接 `npx vitest` / `npx tsc` 可用。
- **测试入口**：仓库根 `npx vitest run [path]`。注意：根 `vitest.config.ts` 现有 include 不覆盖 `packages/client/__tests__/`（该包测试目前被根运行静默跳过）—— Task 3 修复。
- **代码风格**：中文注释、与周边文件同密度；所有函数带类型；单文件 ≤400 行；不用 `any`（parser 里解 raw OpenAPI 的 `any` 除外，沿用 parser.ts 现状）。
- **依赖纪律**：不引入新第三方包。唯一依赖变动：client 的 `typescript` devDep→dep；cli +`@nx-mk/client`（workspace）；根 devDeps +`@nx-mk/manifest`/`@nx-mk/client`（Task 7 集成测试需要）。
- **命名同源**：codemod 与 codegen 的 namespace/method 名一律来自 `deriveNamespace` / `deriveMethodName`（`packages/client/src/codegen/emit-endpoint.ts` 已导出），禁止另行实现。
- **提交**：Conventional Commits，消息末尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。每个 Task 至少一个 commit。
- **当前分支**：`feat/phase15-close-loop-cg3`（spec 已提交）。

---

### Task 1: parser named-ref 预扫描 + SchemaRef `items` 扩展

**Files:**
- Modify: `packages/manifest-schema/src/types.ts:77-83`（SchemaRef 类型）
- Modify: `packages/manifest/src/parser.ts`（预扫描 + 组装回填）
- Test: `packages/manifest/src/__tests__/parser-refs.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `parseOpenApi(specPath)`（不改变签名）、`SchemaRef` 类型
- Produces: `parseOpenApi` 产物中 `endpoints[].responses[].schema` 出现 `{kind:'named'|'array'}`、`endpoints[].request.body` 出现 `{kind:'named'}`；`SchemaRef` 数组分支带 `items?: SchemaRef`。Task 2/7 依赖此形态。

- [ ] **Step 1: 写失败测试**

新建 `packages/manifest/src/__tests__/parser-refs.test.ts`（fixture 风格沿用 `parser.test.ts`：临时目录 + writeFileSync JSON spec）：

```ts
/**
 * parseOpenApi named-ref 预扫描单测（Phase 1.5 闭环，spec §3.2）
 *
 * dereference 会内联所有 $ref；本组用例锁死「raw 预扫描保留顶层 named ref」的行为：
 * 响应 $ref → named；array + items.$ref → array+items；requestBody $ref → named；
 * inline 对象维持 object；RFC6901 转义名正确还原。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOpenApi } from '../parser.js'

let workDir: string

const userSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' }, name: { type: 'string' } },
}

function writeSpec(paths: Record<string, unknown>, schemas: Record<string, unknown>): string {
  const spec = {
    openapi: '3.0.3',
    info: { title: 't', version: '0' },
    paths,
    components: { schemas },
  }
  const p = join(workDir, 'spec.json')
  writeFileSync(p, JSON.stringify(spec))
  return p
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-refs-test-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('parseOpenApi named refs', () => {
  it('响应 $ref → { kind: named }', async () => {
    const spec = writeSpec(
      {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
          },
        },
      },
      { User: userSchema },
    )
    const manifest = await parseOpenApi(spec)
    const ep = manifest.endpoints.find((e) => e.path === '/users/{id}')!
    expect(ep.responses[0]!.schema).toEqual({ kind: 'named', name: 'User' })
  })

  it('array + items.$ref → { kind: array, items: { kind: named } }', async () => {
    const spec = writeSpec(
      {
        '/users': {
          get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } } },
        },
      },
      { User: userSchema },
    )
    const manifest = await parseOpenApi(spec)
    expect(manifest.endpoints[0]!.responses[0]!.schema).toEqual({
      kind: 'array',
      items: { kind: 'named', name: 'User' },
    })
  })

  it('requestBody $ref → request.body { kind: named }', async () => {
    const spec = writeSpec(
      {
        '/orders': {
          post: {
            responses: { 201: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } },
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } } } },
          },
        },
      },
      { Order: userSchema, NewOrder: userSchema },
    )
    const manifest = await parseOpenApi(spec)
    expect(manifest.endpoints[0]!.request?.body).toEqual({ kind: 'named', name: 'NewOrder' })
  })

  it('inline 对象响应维持 { kind: object }（向后兼容）', async () => {
    const spec = writeSpec(
      {
        '/err': {
          get: { responses: { 404: { description: 'e', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } } } },
        },
      },
      {},
    )
    const manifest = await parseOpenApi(spec)
    expect(manifest.endpoints[0]!.responses[0]!.schema).toEqual({ kind: 'object' })
  })

  it('RFC6901 转义名还原：~1 → /', async () => {
    const spec = writeSpec(
      {
        '/x': {
          get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Weird~1Name' } } } } } },
        },
      },
      { 'Weird/Name': userSchema },
    )
    const manifest = await parseOpenApi(spec)
    expect(manifest.endpoints[0]!.responses[0]!.schema).toEqual({ kind: 'named', name: 'Weird/Name' })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/manifest/src/__tests__/parser-refs.test.ts`
Expected: FAIL —— named 用例得到 `{kind:'object'}`（或 `toEqual` 不匹配 array items / request.body 为 undefined）

- [ ] **Step 3: 实现**

3a. `packages/manifest-schema/src/types.ts` 替换 SchemaRef 定义（77-83 行区域）：

```ts
// 响应/请求 body 的 schema 引用（Phase 1.5 起：parser 在 dereference 前预扫描 raw spec，
// 保留顶层 named ref 与 array items；纯类型扩展，向后兼容）
export type SchemaRef =
  | { kind: 'named'; name: string }
  | { kind: 'inline' }
  | { kind: 'array'; items?: SchemaRef }
  | { kind: 'object' }
  | { kind: 'primitive'; type: string }
```

3b. `packages/manifest/src/parser.ts` —— `parseOpenApi` 内 dereference 前后改为：

```ts
  // new SwaggerParser().dereference 解引用所有 $ref 并校验 spec。
  // （默认导出是类构造函数——必须用 new 调用）
  // named ref 只存在于原文：deref 前先按 path+method 预扫描 raw spec（spec §3.2）
  const rawApi: any = JSON.parse(raw)
  const rawRefs = extractRawSchemaRefs(rawApi)
  const api: any = await new SwaggerParser().dereference(rawApi)
```

替换响应 push 一行：

```ts
        const refs = rawRefs.get(`${httpMethod}:${path}`)
```

```ts
        responses.push({
          status,
          schema: refs?.responses[status] ?? (schema ? { kind: 'object' } : undefined),
          fields: responseFields,
        })
```

`endpoints.push` 的 request 组装替换为（新增 body 回填）：

```ts
        request:
          pathParams.length || query.length || headers.length || refs?.body
            ? {
                pathParams: pathParams.length ? pathParams : undefined,
                query: query.length ? query : undefined,
                headers: headers.length ? headers : undefined,
                ...(refs?.body ? { body: refs.body } : {}),
              }
            : undefined,
```

文件末尾追加三个辅助函数：

```ts
// =====================================================================
// raw spec 预扫描 —— named ref 只在原文存在（deref 会内联），spec §3.2
// =====================================================================

interface RawEndpointRefs {
  responses: Record<string, SchemaRef | undefined>
  body?: SchemaRef
}

/** 按 `METHOD:path` 提取每个 operation 的响应/requestBody 顶层 schema 引用（只看顶层，不递归） */
function extractRawSchemaRefs(api: any): Map<string, RawEndpointRefs> {
  const map = new Map<string, RawEndpointRefs>()
  for (const [path, pathItem] of Object.entries<any>(api.paths ?? {})) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue
      const responses: Record<string, SchemaRef | undefined> = {}
      for (const [status, response] of Object.entries<any>(operation.responses ?? {})) {
        responses[status] = classifyRawSchema(response?.content?.['application/json']?.schema)
      }
      const body = classifyRawSchema(operation.requestBody?.content?.['application/json']?.schema)
      map.set(`${method.toUpperCase()}:${path}`, { responses, body })
    }
  }
  return map
}

/** 顶层分类：$ref → named；array → array(+items)；原始类型 → primitive；其余 object（异常形态降级不抛错） */
function classifyRawSchema(schema: any): SchemaRef | undefined {
  if (!schema) return undefined
  if (typeof schema.$ref === 'string') return { kind: 'named', name: refName(schema.$ref) }
  if (schema.type === 'array') {
    const items = classifyRawSchema(schema.items)
    return items ? { kind: 'array', items } : { kind: 'array' }
  }
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer' || schema.type === 'boolean') {
    return { kind: 'primitive', type: schema.type }
  }
  return { kind: 'object' }
}

/** '#/components/schemas/User' → 'User'；RFC6901 反逃逸：~1 → /、~0 → ~ */
function refName(ref: string): string {
  const last = ref.split('/').pop() ?? ''
  return last.replace(/~1/g, '/').replace(/~0/g, '~')
}
```

3c. `types.ts` 中 `ApiEndpoint.request.body` 的行注释更新为 `body?: SchemaRef  // Phase 1.5：raw 预扫描回填的 requestBody 引用`。

- [ ] **Step 4: 运行新测试 + 既有 parser 测试确认全绿**

Run: `npx vitest run packages/manifest/src/__tests__/`
Expected: PASS（parser.test.ts 既有 10 例不受影响 —— 原 `{kind:'object'}` 响应fixture 若为 inline 对象则行为不变）

- [ ] **Step 5: 全仓 typecheck**

Run: `corepack pnpm --filter @nx-mk/manifest-schema typecheck && corepack pnpm --filter @nx-mk/manifest typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/manifest-schema/src/types.ts packages/manifest/src/parser.ts packages/manifest/src/__tests__/parser-refs.test.ts
git commit -m "feat(manifest): preserve top-level named schema refs via raw-spec pre-scan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: emit-endpoint —— array-of-named 返回类型 + 参数类型推导

**Files:**
- Modify: `packages/client/src/codegen/emit-endpoint.ts`
- Test: `packages/client/__tests__/codegen.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `SchemaRef { kind:'array'; items?: SchemaRef }`、`ApiField.type`（'string'|'number'|'integer'|'boolean'|…）
- Produces: `emitEndpoint(endpoint).signature` 形如 `getUser: (params: { id: string }): Promise<User> => {` 与 `listUsers: ...: Promise<User[]>`。Task 7 集成测试按此断言。

- [ ] **Step 1: 写失败测试**

在 `packages/client/__tests__/codegen.test.ts` 末尾追加（复用该文件已有的 import 与 fixture 风格；`ArrayEndpoint`/`TypedEndpoint` 就地构造）：

```ts
describe('emitEndpoint 返回类型（array-of-named，spec §3.3）', () => {
  it('named → Promise<User>', () => {
    const ep: ApiEndpoint = {
      id: 'e1', method: 'GET', path: '/users/{id}', operationId: 'getUser', tags: ['users'],
      request: { pathParams: [field('id', 'string', true)] },
      responses: [{ status: '200', schema: { kind: 'named', name: 'User' }, fields: [] }],
    }
    expect(emitEndpoint(ep).signature).toBe('getUser: (params: { id: string }): Promise<User> => {')
  })

  it('array + named items → Promise<User[]>', () => {
    const ep: ApiEndpoint = {
      id: 'e2', method: 'GET', path: '/users', tags: ['users'],
      responses: [{ status: '200', schema: { kind: 'array', items: { kind: 'named', name: 'User' } }, fields: [] }],
    }
    expect(emitEndpoint(ep).signature).toBe('listUsers: (params: {}): Promise<User[]> => {')
  })

  it('无 schema / object → unknown（现状不变）', () => {
    const ep: ApiEndpoint = {
      id: 'e3', method: 'GET', path: '/x',
      responses: [{ status: '200', schema: { kind: 'object' }, fields: [] }],
    }
    expect(emitEndpoint(ep).signature).toContain('Promise<unknown>')
  })
})

describe('emitEndpoint 参数类型从 field.type 推导（spec §3.3）', () => {
  it('string/number/boolean → TS 原始类型；其余 unknown', () => {
    const ep: ApiEndpoint = {
      id: 'e4', method: 'GET', path: '/items/{a}/{b}/{c}/{d}',
      request: {
        pathParams: [field('a', 'string', true), field('b', 'integer', true), field('c', 'boolean', false), field('d', 'object', true)],
      },
      responses: [],
    }
    const sig = emitEndpoint(ep).signature
    expect(sig).toContain('a: string')
    expect(sig).toContain('b: number')
    expect(sig).toContain('c?: boolean')
    expect(sig).toContain('d: unknown')
  })
})

// 测试辅助：构造 ApiField 最小形态
function field(name: string, type: string, required: boolean): ApiField {
  return {
    id: `f_${name}`, endpointId: 'e', direction: 'request',
    path: name, normalizedPath: name, name, type, required,
    source: { openapiPointer: '' },
  }
}
```

注意：该文件顶部 import 需补 `ApiField`（现有 `import type { ApiManifest } from '@nx-mk/manifest-schema'` 扩为 `{ ApiManifest, ApiEndpoint, ApiField }`）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/client/__tests__/codegen.test.ts`
Expected: FAIL —— 现状 `Promise<unknown>`、参数 `unknown`。（注：若根 vitest include 未覆盖此文件，先临时 `cd packages/client && npx vitest run __tests__` 运行，Task 3 修复 include）

- [ ] **Step 3: 实现 emit-endpoint.ts**

3a. import 行扩为：

```ts
import type { ApiEndpoint, ApiField, HttpMethod, SchemaRef } from '@nx-mk/manifest-schema'
```

3b. 82 行 `const respType = ...` 替换：

```ts
  const respType = formatResponseType(respSchema)
```

3c. `buildParamsType` 内两处类型插值替换：

```ts
    for (const p of pp) {
      parts.push(`${p.name}${p.required === false ? '?' : ''}: ${fieldTypeToTs(p.type)}`)
    }
    for (const q of qp) {
      parts.push(`${q.name}${q.required === false ? '?' : ''}?: ${fieldTypeToTs(q.type)}`)
    }
```

（query 现状多一个冗余 `?` 拼接 `?:` —— 保持现状不动，只换类型插值。）

3d. 文件末尾追加：

```ts
/** SchemaRef → TS 类型：named → name；array+named items → Name[]；其余 unknown（spec §3.3） */
function formatResponseType(schema: SchemaRef | undefined): string {
  if (!schema) return 'unknown'
  if (schema.kind === 'named') return schema.name
  if (schema.kind === 'array' && schema.items?.kind === 'named') return `${schema.items.name}[]`
  return 'unknown'
}

/** ApiField.type → TS 原始类型；未知类型保持 unknown（spec §3.3） */
function fieldTypeToTs(type: string): string {
  switch (type) {
    case 'string': return 'string'
    case 'number':
    case 'integer': return 'number'
    case 'boolean': return 'boolean'
    default: return 'unknown'
  }
}
```

3e. 文件头注释「返回：从 responses[0].schema.name（named 引用）」更新为「返回：named / array-of-named（§3.3）；参数类型从 field.type 推导」。

- [ ] **Step 4: 运行确认全绿**

Run: `npx vitest run packages/client/__tests__/codegen.test.ts`（或包内运行）
Expected: PASS（既有用例无回归）

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/codegen/emit-endpoint.ts packages/client/__tests__/codegen.test.ts
git commit -m "feat(client): typed returns for array-of-named + param types from field.type

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: migrate codemod 引擎（纯函数核心）

**Files:**
- Create: `packages/client/src/migrate/engine.ts`
- Create: `packages/client/src/migrate/index.ts`
- Create: `packages/client/__tests__/migrate.test.ts`
- Modify: `vitest.config.ts`（根 include 补 client 布局）

**Interfaces:**
- Consumes: `ApiManifest`/`ApiEndpoint`（manifest-schema）、`deriveNamespace`/`deriveMethodName`（codegen/emit-endpoint）
- Produces:
```ts
migrateCodemod(input: {
  manifest: ApiManifest
  files: { path: string; content: string }[]
  apiPrefix?: string            // 默认 '/api'
  importSpecifier?: string      // 默认 './generated-sdk'
}): {
  files: { path: string; content: string; changed: boolean }[]
  report: {
    replaced: { path: string; from: string; to: string }[]
    skipped: { path: string; fetch: string; reason: string }[]
  }
}
```
Task 6（CLI）按此签名调用。

- [ ] **Step 0: 修复根 vitest include（client 测试纳入根运行）**

`vitest.config.ts` 的 `test.include` 数组追加一项：

```ts
      // @nx-mk/client 用包根 __tests__/ 布局（其余包是 src/__tests__/）
      'packages/*/__tests__/**/*.test.ts',
```

Run: `npx vitest run packages/client` Expected: 既有 `codegen.test.ts`（含 Task 2 新用例）纳入且 PASS。

- [ ] **Step 1: 写失败测试** —— 新建 `packages/client/__tests__/migrate.test.ts`：

```ts
/**
 * migrate codemod 引擎单测（SDK-CG3，spec §3.4）
 *
 * 锁死：命中替换（GET/POST、0/1 参数）、四类 skip、import 插入去重、
 * 多处替换、未命中文件不改动。IO 不进引擎 —— 输入输出都是字符串。
 */
import { describe, it, expect } from 'vitest'
import type { ApiManifest } from '@nx-mk/manifest-schema'
import { migrateCodemod } from '../src/migrate/index.js'

const MANIFEST: ApiManifest = {
  version: '1',
  source: { type: 'openapi', input: 'test.json', hash: 'abc' },
  generatedAt: '2026-09-16T00:00:00Z',
  schemas: {},
  fields: [],
  endpoints: [
    {
      id: 'ep1', method: 'GET', path: '/users/{id}', operationId: 'getUser', tags: ['users'],
      request: {
        pathParams: [{
          id: 'f1', endpointId: 'ep1', direction: 'request', path: 'id', normalizedPath: 'id',
          name: 'id', type: 'string', required: true, source: { openapiPointer: '' },
        }],
      },
      responses: [{ status: '200', schema: { kind: 'named', name: 'User' }, fields: [] }],
    },
    {
      id: 'ep2', method: 'GET', path: '/users', tags: ['users'],
      responses: [{ status: '200', schema: { kind: 'array', items: { kind: 'named', name: 'User' } }, fields: [] }],
    },
    {
      id: 'ep3', method: 'POST', path: '/orders', tags: ['orders'],
      responses: [{ status: '201', schema: { kind: 'named', name: 'Order' }, fields: [] }],
    },
  ],
}

function migrate(content: string, apiPrefix = '/api') {
  return migrateCodemod({ manifest: MANIFEST, files: [{ path: 'src/a.ts', content }], apiPrefix })
}

describe('migrateCodemod 替换', () => {
  it('路径参数 → api.users.getUser({ id: "u_001" })', () => {
    const { files, report } = migrate(`const p = fetch('/api/users/u_001')`)
    expect(files[0]!.changed).toBe(true)
    expect(files[0]!.content).toContain(`api.users.getUser({ id: "u_001" })`)
    expect(report.replaced).toHaveLength(1)
    expect(report.skipped).toHaveLength(0)
  })

  it('无参数 GET → api.users.listUsers()（派生名与 codegen 同源）', () => {
    const { files } = migrate(`const r = fetch('/api/users')`)
    expect(files[0]!.content).toContain('api.users.listUsers()')
  })

  it('第二参仅 method → 采用并转大写', () => {
    const { files } = migrate(`fetch('/api/orders', { method: 'post' })`)
    expect(files[0]!.content).toContain('api.orders.createOrders()')
  })

  it('同文件多处替换', () => {
    const { files, report } = migrate(`fetch('/api/users')\nfetch('/api/users/u_001')`)
    expect(report.replaced).toHaveLength(2)
    expect(files[0]!.content).toContain('api.users.listUsers()')
    expect(files[0]!.content).toContain('api.users.getUser({ id: "u_001" })')
  })
})

describe('migrateCodemod 跳过（reason 可读）', () => {
  it('动态模板字符串 → dynamic url', () => {
    const { report } = migrate('fetch(`/api/users/${id}`)')
    expect(report.skipped[0]!.reason).toBe('dynamic url')
  })

  it('带 query → query in url', () => {
    const { report } = migrate(`fetch('/api/users?page=1')`)
    expect(report.skipped[0]!.reason).toBe('query in url')
  })

  it('init 含 body/headers → request init not supported', () => {
    const { report } = migrate(`fetch('/api/orders', { method: 'POST', body: JSON.stringify(x) })`)
    expect(report.skipped[0]!.reason).toBe('request init not supported')
  })

  it('前缀外 → outside api prefix', () => {
    const { report } = migrate(`fetch('https://cdn.example.com/api/asset')`)
    // 注意：该 URL 的 path 是 /api/asset —— 引擎按「以 /api/ 开头」判定字面量整体，
    // https:// 开头不命中前缀 → outside api prefix
    expect(report.skipped[0]!.reason).toBe('outside api prefix')
  })

  it('无 endpoint 匹配 → no endpoint match', () => {
    const { report } = migrate(`fetch('/api/nope')`)
    expect(report.skipped[0]!.reason).toBe('no endpoint match')
  })

  it('段数不符不误替换：/api/users/a/b 无匹配', () => {
    const { report } = migrate(`fetch('/api/users/a/b')`)
    expect(report.skipped[0]!.reason).toBe('no endpoint match')
  })
})

describe('migrateCodemod import 处理', () => {
  it('缺 import 时插入，specifier 可覆盖', () => {
    const { files } = migrate(`const p = fetch('/api/users/u_001')`)
    expect(files[0]!.content).toContain(`import { api } from './generated-sdk'`)
  })

  it('已有同 specifier import 不重复插入', () => {
    const { files } = migrate(`import { api } from './generated-sdk'\nexport const p = fetch('/api/users/u_001')`)
    const count = files[0]!.content.split(`import { api } from './generated-sdk'`).length - 1
    expect(count).toBe(1)
  })

  it('未命中文件 changed=false 且内容原样', () => {
    const { files } = migrate(`export const x = 1`)
    expect(files[0]).toEqual({ path: 'src/a.ts', content: `export const x = 1`, changed: false })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/client/__tests__/migrate.test.ts`
Expected: FAIL —— `Cannot find module '../src/migrate/index.js'`

- [ ] **Step 3: 实现 engine.ts** —— 新建 `packages/client/src/migrate/engine.ts`：

```ts
/**
 * SDK-CG3 migrate codemod —— fetch('/api/...') → api.ns.method({...}) 静态替换
 *
 * 纯函数核心（spec §3.4）：输入文件内容数组，输出替换后内容与报告；文件 IO 由调用方
 * （CLI）完成。匹配规则：
 *   1. fetch CallExpression，首参 StringLiteral / NoSubstitutionTemplateLiteral
 *   2. 值以 apiPrefix + '/' 开头（否则 outside api prefix）
 *   3. 含 '?' → query in url；模板字符串带插值 → dynamic url
 *   4. 第二参缺省 → GET；ObjectLiteral 仅含 method 字面量 → 采用；否则 request init not supported
 *   5. 剥前缀后按段与 endpoint path 模板匹配（段数相等、字面段相等、{param} 捕获）
 *   6. 替换为 api.ns.method() / api.ns.method({ id: "v" })；ns/method 走 codegen 同源 derive
 *   7. 有替换且缺 import → 插入 `import { api } from '<importSpecifier>'`（按 specifier 去重）
 */

import ts from 'typescript'
import type { ApiEndpoint, ApiManifest } from '@nx-mk/manifest-schema'
import { deriveMethodName, deriveNamespace } from '../codegen/emit-endpoint.js'

export interface MigrateCodemodInput {
  manifest: ApiManifest
  files: { path: string; content: string }[]
  apiPrefix?: string
  importSpecifier?: string
}

export interface MigrateReport {
  replaced: { path: string; from: string; to: string }[]
  skipped: { path: string; fetch: string; reason: string }[]
}

export interface MigrateCodemodResult {
  files: { path: string; content: string; changed: boolean }[]
  report: MigrateReport
}

interface Edit {
  start: number
  end: number
  text: string
}

interface EndpointIndexEntry {
  endpoint: ApiEndpoint
  namespace: string
  methodName: string
  segments: string[] // path 模板按 '/' 切段，'{id}' 表示参数段
}

export function migrateCodemod(input: MigrateCodemodInput): MigrateCodemodResult {
  const apiPrefix = input.apiPrefix ?? '/api'
  const importSpecifier = input.importSpecifier ?? './generated-sdk'
  const index = buildEndpointIndex(input.manifest.endpoints)
  const report: MigrateReport = { replaced: [], skipped: [] }

  const files = input.files.map((file) => {
    const edits = collectEdits(file, { apiPrefix, index, report })
    if (edits.length === 0) return { ...file, changed: false }

    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true)
    if (!hasApiImport(source, importSpecifier)) {
      edits.push(importInsertEdit(source, importSpecifier))
    }
    return { path: file.path, content: applyEdits(file.content, edits), changed: true }
  })

  return { files, report }
}

// ─── endpoint 索引：method → 候选模板段 ─────────────────────────────────────

function buildEndpointIndex(endpoints: ApiEndpoint[]): Map<string, EndpointIndexEntry[]> {
  const map = new Map<string, EndpointIndexEntry[]>()
  for (const endpoint of endpoints) {
    const lastSeg = endpoint.path.split('/').filter((s) => s && !s.startsWith('{')).pop() ?? 'root'
    const entry: EndpointIndexEntry = {
      endpoint,
      namespace: deriveNamespace(endpoint),
      methodName: deriveMethodName(endpoint, lastSeg),
      segments: endpoint.path.split('/').filter(Boolean),
    }
    const list = map.get(endpoint.method) ?? []
    list.push(entry)
    map.set(endpoint.method, list)
  }
  return map
}

// ─── 单文件扫描：产出 Edit 列表（含替换与报告） ─────────────────────────────

interface ScanContext {
  apiPrefix: string
  index: Map<string, EndpointIndexEntry[]>
  report: MigrateReport
}

function collectEdits(
  file: { path: string; content: string },
  ctx: ScanContext,
): Edit[] {
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true)
  const edits: Edit[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
      handleFetchCall(node, file.path, source, ctx, edits)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edits
}

function handleFetchCall(
  call: ts.CallExpression,
  path: string,
  source: ts.SourceFile,
  ctx: ScanContext,
  edits: Edit[],
): void {
  const fetchText = call.getText(source)
  const skip = (reason: string): void => {
    ctx.report.skipped.push({ path, fetch: fetchText, reason })
  }

  // 规则 1：首参必须是静态字符串字面量
  const first = call.arguments[0]
  if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
    skip('dynamic url')
    return
  }
  const url = first.text

  // 规则 2：apiPrefix + '/' 前缀
  if (!url.startsWith(`${ctx.apiPrefix}/`)) {
    skip('outside api prefix')
    return
  }
  const rest = url.slice(ctx.apiPrefix.length)

  // 规则 3：query / 动态段
  if (rest.includes('?')) {
    skip('query in url')
    return
  }

  // 规则 4：第二参 —— 缺省 GET；仅 method 字面量可用
  let method = 'GET'
  const second = call.arguments[1]
  if (second !== undefined) {
    if (!ts.isObjectLiteralExpression(second)) {
      skip('request init not supported')
      return
    }
    const props = second.properties
    const nonMethod = props.filter(
      (p) => !(ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'method'),
    )
    if (nonMethod.length > 0) {
      skip('request init not supported')
      return
    }
    const methodProp = props.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'method',
    )
    if (methodProp) {
      const init = methodProp.initializer
      if (!ts.isStringLiteral(init)) {
        skip('request init not supported')
        return
      }
      method = init.text.toUpperCase()
    }
  }

  // 规则 5：段匹配（第一个命中的 endpoint 获胜）
  const segs = rest.split('/').filter(Boolean)
  let matched: { entry: EndpointIndexEntry; params: Record<string, string> } | undefined
  for (const entry of ctx.index.get(method) ?? []) {
    if (entry.segments.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < segs.length; i++) {
      const tpl = entry.segments[i]!
      if (tpl.startsWith('{') && tpl.endsWith('}')) {
        params[tpl.slice(1, -1)] = segs[i]!
      } else if (tpl !== segs[i]) {
        ok = false
        break
      }
    }
    if (ok) {
      matched = { entry, params }
      break
    }
  }
  if (!matched) {
    skip('no endpoint match')
    return
  }

  // 规则 6：构造替换文本
  const argEntries = Object.entries(matched.params)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ')
  const to =
    argEntries.length > 0
      ? `api.${matched.entry.namespace}.${matched.entry.methodName}({ ${argEntries} })`
      : `api.${matched.entry.namespace}.${matched.entry.methodName}()`
  edits.push({ start: call.getStart(source), end: call.getEnd(), text: to })
  ctx.report.replaced.push({ path, from: fetchText, to })
}

// ─── import 检测与插入 ──────────────────────────────────────────────────────

function hasApiImport(source: ts.SourceFile, specifier: string): boolean {
  return source.statements.some(
    (st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === specifier,
  )
}

function importInsertEdit(source: ts.SourceFile, specifier: string): Edit {
  const stmt = `import { api } from '${specifier}'`
  const imports = source.statements.filter((st) => ts.isImportDeclaration(st))
  if (imports.length > 0) {
    const last = imports[imports.length - 1]!
    return { start: last.getEnd(), end: last.getEnd(), text: `\n${stmt}` }
  }
  // 无 import：插到首条语句前（保留其前导注释/空白）
  const first = source.statements[0]
  const pos = first ? first.getStart(source) : 0
  return { start: pos, end: pos, text: `${stmt}\n` }
}

function applyEdits(content: string, edits: Edit[]): string {
  // 从后往前应用，避免前面的插入使后面偏移失效
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  let out = content
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return out
}
```

新建 `packages/client/src/migrate/index.ts`：

```ts
/**
 * @nx-mk/client/migrate —— SDK-CG3 静态迁移引擎（spec §3.4）
 *
 * 纯函数：文件 IO 留给 CLI（nx-ce 式薄适配分层）。业务代码不直接消费本模块。
 */

export {
  migrateCodemod,
  type MigrateCodemodInput,
  type MigrateCodemodResult,
  type MigrateReport,
} from './engine.js'
```

- [ ] **Step 4: 运行确认全绿**

Run: `npx vitest run packages/client/__tests__/`
Expected: PASS（migrate 15 例 + codegen 既有）

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/migrate packages/client/__tests__/migrate.test.ts vitest.config.ts
git commit -m "feat(client): migrate codemod engine — fetch to api.ns.method static rewrite (SDK-CG3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: client 构建接线（tsup entry + exports + typescript 依赖）

**Files:**
- Modify: `packages/client/tsup.config.ts`
- Modify: `packages/client/package.json`
- Modify: `packages/client/src/index.ts`（注释提及 migrate）

**Interfaces:**
- Produces: `import { migrateCodemod } from '@nx-mk/client/migrate'` 可用（dist 构建产物 + exports map）。Task 6 依赖。

- [ ] **Step 1: tsup entry 追加** —— `entry` 对象加一行：

```ts
    migrate: 'src/migrate/index.ts',
```

`external` 数组加 `'typescript'`（codemod 运行时依赖 TS Compiler API）。

- [ ] **Step 2: package.json** —— `typescript` 从 `devDependencies` 移到 `dependencies`（版本串原样 `"^5.3.3"`）；`exports` 追加：

```json
    "./migrate": {
      "types": "./dist/migrate.d.ts",
      "import": "./dist/migrate.js"
    },
```

- [ ] **Step 3: 构建 + 验证产物**

Run: `corepack pnpm --filter @nx-mk/client build`
Expected: 构建成功，`packages/client/dist/migrate.js` 与 `dist/migrate.d.ts` 存在（`ls packages/client/dist/ | grep migrate`）

- [ ] **Step 4: Commit**

```bash
git add packages/client/tsup.config.ts packages/client/package.json
git commit -m "build(client): expose ./migrate entry; promote typescript to runtime dep (SDK-CG3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: patchGlobalFetch —— fetch monkey-patch fallback

**Files:**
- Create: `packages/client/src/runtime/patch.ts`
- Modify: `packages/client/src/runtime/index.ts`（追加导出）
- Test: `packages/client/__tests__/patch.test.ts`（新建）

**Interfaces:**
- Produces: `patchGlobalFetch(options?: { apiPrefix?: string; onCapture?: (info: { method: string; url: string }) => void }): () => void`（从 `@nx-mk/client/runtime` 导出）。幂等：已 patch 时再次调用返回 no-op unpatch。Phase 2 collector 将接入 `onCapture`。

- [ ] **Step 1: 写失败测试** —— 新建 `packages/client/__tests__/patch.test.ts`：

```ts
/**
 * patchGlobalFetch 单测（SDK-CG3b，spec §3.5）
 *
 * 锁死：命中回调+委托、未命中只委托、幂等不叠加、unpatch 还原、无 fetch 环境降级。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { patchGlobalFetch } from '../src/runtime/patch.js'

const fakeResponse = () => new Response('{"ok":true}', { status: 200 })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('patchGlobalFetch', () => {
  it('命中 apiPrefix：先回调 onCapture，再委托原 fetch', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const captured: { method: string; url: string }[] = []
    const unpatch = patchGlobalFetch({ onCapture: (i) => captured.push(i) })

    await fetch('/api/users/u_001')
    expect(captured).toEqual([{ method: 'GET', url: '/api/users/u_001' }])
    expect(original).toHaveBeenCalledOnce()
    unpatch()
  })

  it('未命中前缀：不回调，仍委托', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const onCapture = vi.fn()
    const unpatch = patchGlobalFetch({ onCapture })

    await fetch('https://example.com/other')
    expect(onCapture).not.toHaveBeenCalled()
    expect(original).toHaveBeenCalledOnce()
    unpatch()
  })

  it('init.method / URL 对象 / Request 形态都能解析', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const captured: string[] = []
    const unpatch = patchGlobalFetch({ onCapture: (i) => captured.push(i.method) })

    await fetch('/api/orders', { method: 'POST' })
    await fetch(new URL('http://localhost/api/users'))
    await fetch(new Request('http://localhost/api/users/u_001', { method: 'DELETE' }))
    expect(captured).toEqual(['POST', 'GET', 'DELETE'])
    unpatch()
  })

  it('幂等：已 patch 时再次调用返回 no-op，不叠加包裹', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const onCapture = vi.fn()
    const unpatch1 = patchGlobalFetch({ onCapture })
    const unpatch2 = patchGlobalFetch({ onCapture })

    await fetch('/api/users')
    expect(onCapture).toHaveBeenCalledOnce() // 只包了一层

    unpatch2() // no-op
    await fetch('/api/users')
    expect(onCapture).toHaveBeenCalledTimes(2)

    unpatch1()
  })

  it('unpatch 还原：后续调用不再回调', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const onCapture = vi.fn()
    const unpatch = patchGlobalFetch({ onCapture })
    unpatch()

    await fetch('/api/users')
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('无 fetch 环境：返回 no-op unpatch 且不抛错', () => {
    vi.stubGlobal('fetch', undefined)
    const unpatch = patchGlobalFetch()
    expect(() => unpatch()).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/client/__tests__/patch.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现** —— 新建 `packages/client/src/runtime/patch.ts`：

```ts
/**
 * patchGlobalFetch —— fetch monkey-patch fallback（SDK-CG3b，spec §3.5）
 *
 * 用途（Plan §42.5）：项目装了 @mk/client 但没全量迁移时，未替换的裸 fetch()
 * 也走统一探针缝，coverage 不丢失。Phase 1.5 只落机制：命中 apiPrefix 时回调
 * onCapture（Phase 2 collector 在此接入），随后无条件委托原 fetch。
 *
 * 约束：
 * - 幂等：已 patch 时再次调用直接返回 no-op unpatch，不叠加包裹
 * - 探针异常不得影响业务请求（try/catch 吞掉）
 * - globalThis.fetch 不存在的环境直接返回 no-op
 */

export interface PatchGlobalFetchOptions {
  /** API 路径前缀，默认 '/api'（与 codegen baseUrl 对齐） */
  apiPrefix?: string
  /** 命中前缀的请求回调（Phase 2 collector 接入点） */
  onCapture?: (info: { method: string; url: string }) => void
}

// 模块级单例：同一时刻最多一层包裹
let activeUnpatch: (() => void) | null = null

export function patchGlobalFetch(options: PatchGlobalFetchOptions = {}): () => void {
  if (activeUnpatch) return () => {} // 幂等：不叠加

  const g = globalThis as { fetch?: typeof fetch }
  const original = g.fetch
  if (typeof original !== 'function') return () => {}

  const apiPrefix = options.apiPrefix ?? '/api'
  const onCapture = options.onCapture

  const patched = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const rawMethod = init?.method ?? (input instanceof Request ? input.method : 'GET')
      const method = rawMethod.toUpperCase()
      const hit = new URL(url, 'http://localhost').pathname.startsWith(apiPrefix)
      if (hit) onCapture?.({ method, url })
    } catch {
      // 探针解析失败不影响业务请求
    }
    return original.call(globalThis, input, init)
  }) as typeof fetch

  g.fetch = patched
  activeUnpatch = () => {
    g.fetch = original
    activeUnpatch = null
  }
  return activeUnpatch
}
```

`packages/client/src/runtime/index.ts` 追加导出：

```ts
export { patchGlobalFetch, type PatchGlobalFetchOptions } from './patch.js'
```

- [ ] **Step 4: 运行确认全绿**

Run: `npx vitest run packages/client/__tests__/`
Expected: PASS（patch 6 例 + 既有）

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/runtime/patch.ts packages/client/src/runtime/index.ts packages/client/__tests__/patch.test.ts
git commit -m "feat(client): patchGlobalFetch fallback with onCapture seam for Phase 2 collector (SDK-CG3b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: CLI `mk migrate` 子命令（薄适配）

**Files:**
- Create: `packages/cli/src/commands/migrate.ts`
- Modify: `packages/cli/src/index.ts`（Subcommand / ParsedArgs / HELP / parseArgs / dispatch）
- Modify: `packages/cli/package.json`（+`@nx-mk/client` workspace dep）
- Test: `packages/cli/src/__tests__/migrate.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 的 `migrateCodemod`（`@nx-mk/client/migrate`）、Task 4 的 dist 产物
- Produces: `runMigrate(opts): Promise<void>`；CLI `nx-mk migrate [--manifest] [--dir] [--api-prefix] [--import] [--dry-run] [--json]`

- [ ] **Step 0: 依赖接线**

`packages/cli/package.json` 的 `dependencies` 加 `"@nx-mk/client": "workspace:*"`，然后：

Run: `corepack pnpm install`
Expected: 链接成功（`packages/cli/node_modules/@nx-mk/client` 出现）

- [ ] **Step 1: 写失败测试** —— 新建 `packages/cli/src/__tests__/migrate.test.ts`：

```ts
/**
 * mk migrate 子命令单测（spec §3.6）
 *
 * 临时 fixture 项目：manifest + src 带 fetch 调用。
 * 锁死：全流程替换写盘、dry-run 不写盘、manifest 缺失 exit 语义、--json 输出。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMigrate } from '../commands/migrate'

let workDir: string

const MANIFEST = {
  version: '1',
  source: { type: 'openapi', input: 'swagger.json', hash: 'x' },
  generatedAt: '2026-09-16T00:00:00Z',
  schemas: {},
  fields: [],
  endpoints: [
    {
      id: 'ep1', method: 'GET', path: '/users/{id}', operationId: 'getUser', tags: ['users'],
      responses: [{ status: '200', schema: { kind: 'named', name: 'User' }, fields: [] }],
    },
  ],
}

const PAGE = `export const load = () => fetch('/api/users/u_001')\n`

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-migrate-test-'))
  mkdirSync(join(workDir, '.nx-mk'))
  writeFileSync(join(workDir, '.nx-mk', 'manifest.json'), JSON.stringify(MANIFEST))
  mkdirSync(join(workDir, 'src'))
  writeFileSync(join(workDir, 'src', 'page.ts'), PAGE)
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// 子命令读 process.cwd() —— 用 chdir 进 fixture（测后还原）
function inWorkDir(fn: () => Promise<void>): Promise<void> {
  const prev = process.cwd()
  process.chdir(workDir)
  return fn().finally(() => process.chdir(prev))
}

describe('runMigrate', () => {
  it('替换并写盘，打印 replaced 摘要', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await inWorkDir(() => runMigrate({}))
    const out = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(readFileSync(join(workDir, 'src', 'page.ts'), 'utf8')).toContain(
      'api.users.getUser({ id: "u_001" })',
    )
    expect(out).toContain('1 replaced')
    expect(out).toContain("import { api } from './generated-sdk'")
  })

  it('dry-run：报告替换但不写盘', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await inWorkDir(() => runMigrate({ dryRun: true }))
    expect(readFileSync(join(workDir, 'src', 'page.ts'), 'utf8')).toBe(PAGE)
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('dry-run')
  })

  it('manifest 缺失 → KernelError CONFIG_NOT_FOUND（提示先跑 nx-mk run）', async () => {
    rmSync(join(workDir, '.nx-mk', 'manifest.json'))
    await inWorkDir(() =>
      expect(runMigrate({})).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' }),
    )
  })

  it('manifest JSON 非法 → CONFIG_INVALID', async () => {
    writeFileSync(join(workDir, '.nx-mk', 'manifest.json'), '{broken')
    await inWorkDir(() =>
      expect(runMigrate({})).rejects.toMatchObject({ code: 'CONFIG_INVALID' }),
    )
  })

  it('--json 输出机器可读 report', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await inWorkDir(() => runMigrate({ json: true }))
    const parsed = JSON.parse(log.mock.calls.map((c) => String(c[0])).join('\n'))
    expect(parsed.report.replaced).toHaveLength(1)
    expect(parsed.report.replaced[0].to).toBe('api.users.getUser({ id: "u_001" })')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/cli/src/__tests__/migrate.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `packages/cli/src/commands/migrate.ts`**：

```ts
/**
 * migrate 子命令 —— SDK-CG3 静态迁移的 CLI 薄适配（spec §3.6）
 *
 * 核心替换逻辑在 @nx-mk/client/migrate 引擎（纯函数）；本文件只做 IO 与展示：
 * 读 manifest.json → 收集源码文件 → 引擎 → 写盘/报告。全部 flag 有默认值，
 * `npx nx-mk migrate` 零配置可跑。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { KernelError } from '@nx-mk/kernel'
import { migrateCodemod } from '@nx-mk/client/migrate'

export interface MigrateOptions {
  /** manifest 路径，默认 ./.nx-mk/manifest.json */
  manifestPath?: string
  /** 扫描目录，默认 ./src */
  dir?: string
  /** fetch URL 前缀，默认 /api */
  apiPrefix?: string
  /** 插入的 api import specifier，默认 ./generated-sdk */
  importSpecifier?: string
  /** 只报告不写盘 */
  dryRun?: boolean
  /** 机器可读 JSON 输出 */
  json?: boolean
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nx-mk'])

export async function runMigrate(opts: MigrateOptions = {}): Promise<void> {
  const cwd = process.cwd()
  const resolvePath = (p: string): string => (isAbsolute(p) ? p : join(cwd, p))

  const manifest = loadManifest(resolvePath(opts.manifestPath ?? '.nx-mk/manifest.json'))
  const dir = resolvePath(opts.dir ?? 'src')
  if (!existsSync(dir)) {
    throw new KernelError('CONFIG_NOT_FOUND', `migrate: source dir not found: ${dir}`)
  }

  const files = collectSourceFiles(dir).map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }))

  const result = migrateCodemod({
    manifest,
    files,
    apiPrefix: opts.apiPrefix,
    importSpecifier: opts.importSpecifier,
  })

  let written = 0
  if (!opts.dryRun) {
    for (const f of result.files) {
      if (f.changed) {
        writeFileSync(f.path, f.content)
        written++
      }
    }
  }

  emitReport(result, { dryRun: opts.dryRun ?? false, json: opts.json ?? false, written })
}

// ─── IO 辅助 ────────────────────────────────────────────────────────────────

function loadManifest(manifestPath: string): Parameters<typeof migrateCodemod>[0]['manifest'] {
  if (!existsSync(manifestPath)) {
    throw new KernelError(
      'CONFIG_NOT_FOUND',
      `migrate: manifest not found at ${manifestPath} — run 'nx-mk run' first`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    throw new KernelError('CONFIG_INVALID', `migrate: manifest is not valid JSON: ${(err as Error).message}`)
  }
  const manifest = parsed as { endpoints?: unknown }
  if (!manifest || !Array.isArray(manifest.endpoints)) {
    throw new KernelError('CONFIG_INVALID', `migrate: manifest missing 'endpoints' array`)
  }
  return manifest as Parameters<typeof migrateCodemod>[0]['manifest']
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (SOURCE_EXTS.has(full.slice(full.lastIndexOf('.')))) out.push(full)
    }
  }
  walk(dir)
  return out
}

// ─── 报告输出 ───────────────────────────────────────────────────────────────

interface ReportMeta {
  dryRun: boolean
  json: boolean
  written: number
}

function emitReport(
  result: ReturnType<typeof migrateCodemod>,
  meta: ReportMeta,
): void {
  const { report } = result
  if (meta.json) {
    console.log(JSON.stringify({ report, written: meta.written, dryRun: meta.dryRun }, null, 2))
    return
  }
  console.log(
    `✔ migrate: ${report.replaced.length} replaced, ${report.skipped.length} skipped` +
      (meta.dryRun ? ' (dry-run: no files written)' : `, ${meta.written} file(s) written`),
  )
  for (const r of report.replaced) {
    console.log(`  replaced  ${r.path}: ${r.from} → ${r.to}`)
  }
  for (const s of report.skipped) {
    console.log(`  skipped   ${s.path}: ${s.reason} — ${s.fetch}`)
  }
  if (report.skipped.length > 0) {
    console.log(`  tip: 未迁移的调用可由 patchGlobalFetch() 兜底（@nx-mk/client/runtime）`)
  }
}
```

- [ ] **Step 4: CLI 入口接线** —— `packages/cli/src/index.ts` 五处修改：

4a. `type Subcommand = 'run' | 'init' | 'doctor' | 'migrate'`。

4b. `ParsedArgs` 接口追加字段：

```ts
  migrate: {
    manifestPath?: string
    dir?: string
    apiPrefix?: string
    importSpecifier?: string
    dryRun: boolean
    json: boolean
  }
```

`parseArgs` 初始 `out` 增加 `migrate: { dryRun: false, json: false }`。

4c. `HELP` 文本 Subcommands 段追加一行（放在 doctor 之后）：

```
  migrate  Migrate static fetch('/api/...') calls to api.ns.method() (SDK-CG3)
```

Options 段追加：

```
  --manifest <path>      Path to .nx-mk/manifest.json (migrate only, default ./.nx-mk/manifest.json)
  --dir <path>           Source dir to scan (migrate only, default ./src)
  --api-prefix <prefix>  fetch URL prefix (migrate only, default /api)
  --import <specifier>   Import specifier for api (migrate only, default ./generated-sdk)
  --dry-run              Report without writing files (migrate only)
  --json                 Machine-readable JSON report (migrate only)
```

4d. `parseArgs` switch 追加 case：

```ts
      case '--manifest':
        out.migrate.manifestPath = argv[++i]
        break
      case '--dir':
        out.migrate.dir = argv[++i]
        break
      case '--api-prefix':
        out.migrate.apiPrefix = argv[++i]
        break
      case '--import':
        out.migrate.importSpecifier = argv[++i]
        break
      case '--dry-run':
        out.migrate.dryRun = true
        break
      case '--json':
        out.migrate.json = true
        break
      case 'migrate':
        out.subcommand = a
        break
```

4e. import 区加 `import { runMigrate } from './commands/migrate.js'`；`main()` 的 switch 追加：

```ts
    case 'migrate':
      await runMigrate(args.migrate)
      return
```

- [ ] **Step 5: 运行确认全绿**

Run: `npx vitest run packages/cli/src/__tests__/`
Expected: PASS（migrate 5 例 + run/init/doctor 既有）

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/migrate.ts packages/cli/src/index.ts packages/cli/package.json packages/cli/src/__tests__/migrate.test.ts
git commit -m "feat(cli): nx-mk migrate subcommand — thin adapter over client codemod engine (SDK-CG3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: hermetic 集成测试（真实 swagger fixture 全链路）

**Files:**
- Create: `tests/fixtures/demo-openapi.json`（从 demo swagger 固化拷贝）
- Create: `tests/integration/phase15-close-loop.test.ts`
- Modify: `vitest.config.ts`（include 追加 tests/**）
- Modify: `package.json`（根 devDependencies + @nx-mk/manifest、@nx-mk/client）

**Interfaces:**
- Consumes: Task 1 `parseOpenApi`、Task 2 `generateSdk`、Task 3 `migrateCodemod`（均经 dist）
- Produces: 全链路回归防线 —— 「真 swagger → manifest（named refs）→ typed SDK 文本 → codemod 替换」断言。

- [ ] **Step 0: fixture 固化 + 依赖**

```bash
cp examples/react-vite-demo/swagger/openapi.json tests/fixtures/demo-openapi.json
```

根 `package.json` devDependencies 追加：

```json
    "@nx-mk/client": "workspace:*",
    "@nx-mk/manifest": "workspace:*",
```

Run: `corepack pnpm install`
Expected: 根 `node_modules/@nx-mk/{client,manifest}` 链接出现

- [ ] **Step 1: vitest include** —— `test.include` 追加：

```ts
      // 根级集成测试（hermetic，不依赖网络/端口）
      'tests/**/*.test.ts',
```

- [ ] **Step 2: 写集成测试** —— 新建 `tests/integration/phase15-close-loop.test.ts`：

```ts
/**
 * Phase 1.5 闭环集成测试（hermetic，spec §1.2-6 / §42.5 验收）
 *
 * 固化的 demo swagger fixture 走完整链路：
 *   parseOpenApi（named refs）→ generateSdk（typed SDK 文本）→ migrateCodemod（fetch 替换）
 * 不启动 server、不占端口；dist 需先构建（corepack pnpm --filter '@nx-mk/*' build）。
 */
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import ts from 'typescript'
import { parseOpenApi } from '@nx-mk/manifest'
import { generateSdk } from '@nx-mk/client/codegen'
import { migrateCodemod } from '@nx-mk/client/migrate'

const FIXTURE = join(__dirname, '..', 'fixtures', 'demo-openapi.json')

describe('Phase 1.5 close loop', () => {
  it('parseOpenApi 保留 named refs（真 demo swagger）', async () => {
    const manifest = await parseOpenApi(FIXTURE)

    const getUser = manifest.endpoints.find((e) => e.path === '/users/{id}')!
    expect(getUser.responses.find((r) => r.status === '200')!.schema).toEqual({
      kind: 'named',
      name: 'User',
    })

    const listUsers = manifest.endpoints.find((e) => e.path === '/users')!
    expect(listUsers.responses.find((r) => r.status === '200')!.schema).toEqual({
      kind: 'array',
      items: { kind: 'named', name: 'User' },
    })

    const createOrder = manifest.endpoints.find((e) => e.path === '/orders')!
    expect(createOrder.request?.body).toEqual({ kind: 'named', name: 'NewOrder' })
  })

  it('generateSdk 产出 typed 签名且可被 TS 编译', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    const code = generateSdk(manifest, { baseUrl: '/api' })

    expect(code).toContain('getUser: (params: { id: string }): Promise<User> => {')
    expect(code).toContain('Promise<User[]>')
    expect(code).toContain('body: NewOrder')

    // 生成文本必须是语法合法的 TS
    const diag = ts.transpileModule(code, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).diagnostics ?? []
    expect(diag).toHaveLength(0)
  })

  it('migrateCodemod 在 demo 同形代码上完成 fetch 替换', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    const { files, report } = migrateCodemod({
      manifest,
      files: [{ path: 'src/legacy.ts', content: `const u = fetch('/api/users/u_001')\n` }],
    })
    expect(report.replaced).toHaveLength(1)
    expect(files[0]!.content).toContain(`api.users.getUser({ id: "u_001" })`)
  })
})
```

- [ ] **Step 3: 构建 + 运行**

Run: `corepack pnpm --filter @nx-mk/manifest build && corepack pnpm --filter @nx-mk/client build && npx vitest run tests/`
Expected: PASS（3 例）

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/demo-openapi.json tests/integration/phase15-close-loop.test.ts vitest.config.ts package.json pnpm-lock.yaml
git commit -m "test(integration): Phase 1.5 close-loop — real swagger to typed SDK to codemod

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: demo 闭环 + 收尾

**Files:**
- Modify: `examples/react-vite-demo/mk.config.yml` → 改名 `nx-mk.config.yml`
- Modify: `examples/react-vite-demo/generate-sdk.ts`（删手写 manifest，读真 manifest.json）
- Modify: `examples/react-vite-demo/app/src/UserProfile.tsx`（真类型 + 真 Field）
- Modify: `package.json`（demo:codegen 串真链路）
- Modify: `README.md`（当前状态）、`.gitignore`（+`.nx-mk/`）、`examples/react-vite-demo/README.md`（运行步骤）

**Interfaces:**
- Consumes: Task 1-7 全部产物；plugin-swagger 已有 beforeRun 写 `.nx-mk/manifest.json`（cwd 语义：`run` 从 demo 目录执行时落在 demo 根）
- Produces: `pnpm demo:codegen` 一键三段链路；demo app 消费真 codegen 产物

- [ ] **Step 1: config 改名**

```bash
git mv examples/react-vite-demo/mk.config.yml examples/react-vite-demo/nx-mk.config.yml
```

文件头注释改为：

```yaml
# nx-mk Phase 1.5 demo config —— 指向 demo 后端生成的 swagger.json
# 用法：在 demo 目录（examples/react-vite-demo）直接 `nx-mk run`
# （findConfigFile 只认 nx-mk.config.{yml,yaml}，故由 mk.config.yml 改名而来）
```

（其余内容不变。）

- [ ] **Step 2: generate-sdk.ts 全文替换**：

```ts
/**
 * demo 闭环第三段（Plan §42.5）：.nx-mk/manifest.json → typed SDK → app/src/generated-sdk.ts
 *
 * 前置两段：
 *   1. `pnpm demo:openapi`   —— demo/server 产出 swagger/openapi.json
 *   2. `nx-mk run`（demo 目录）—— plugin-swagger 解析 swagger.json 产出 .nx-mk/manifest.json
 *
 * manifest.json 由 plugin-swagger 从真实 OpenAPI 生成（含 named refs，Phase 1.5 起），
 * 不再手工构造。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { generateSdk } from '../../packages/client/dist/codegen.js'

const manifestPath = new URL('./.nx-mk/manifest.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const code = generateSdk(manifest, { baseUrl: '/api' })
writeFileSync(new URL('./app/src/generated-sdk.ts', import.meta.url), code)
console.log(`[codegen] wrote app/src/generated-sdk.ts (${code.length} bytes)`)
```

- [ ] **Step 3: UserProfile.tsx 全文替换**：

```tsx
/**
 * SDK Facade usage demo —— 业务代码视角（Phase 1.5 闭环验收形态）
 *
 * `api` 与 `User` 类型均来自 codegen 产物 generated-sdk.ts（真 swagger 链路）：
 *   demo:openapi → nx-mk run（plugin-swagger → manifest.json）→ generate-sdk.ts
 *
 *   - 业务代码只 import `api`，不感知 production / analysis 模式
 *   - <Field>（@nx-mk/client/react）包裹展示字段（Plan §20），渲染 data-mk-field
 *   - internalRiskScore 故意不包裹 → Coverage Policy 期望 ignored
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type User } from './generated-sdk.js'

export function UserProfile() {
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.users
      .getUser({ id: 'u_001' })
      .then((u) => setUser(u))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <div data-page="error">Error: {error}</div>
  if (!user) return <div data-page="loading">Loading…</div>

  return (
    <div data-page="user-profile">
      <h1>
        <Field field="user.profile.name">{user.name}</Field>
      </h1>
      <dl>
        <dt>Email</dt>
        <dd>
          <Field field="user.profile.email">{user.email ?? '—'}</Field>
        </dd>
        <dt>Tags</dt>
        <dd>
          <Field field="user.profile.tags">
            {(user.tags ?? []).join(', ')}
          </Field>
        </dd>
        <dt>Address</dt>
        <dd>
          <Field field="user.profile.address.city">{user.address?.city ?? '—'}</Field>
          {' · '}
          <Field field="user.profile.address.zip">{user.address?.zip ?? '—'}</Field>
        </dd>
        {/* internalRiskScore 故意不包裹 —— Coverage Policy 期望 ignored */}
      </dl>
    </div>
  )
}
```

- [ ] **Step 4: 根 package.json `demo:codegen` 替换为真链路**：

```json
    "demo:codegen": "pnpm --filter @nx-mk-example/server openapi && corepack pnpm --filter @nx-mk/cli build && cd examples/react-vite-demo && node ../../packages/cli/dist/index.js run && pnpm exec tsx generate-sdk.ts",
```

- [ ] **Step 5: 跑通闭环验证（验收核心）**

```bash
corepack pnpm demo:codegen
```

Expected: `[codegen] wrote app/src/generated-sdk.ts (N bytes)`，且 `examples/react-vite-demo/app/src/generated-sdk.ts` 含：

```bash
grep -F 'getUser: (params: { id: string }): Promise<User> =>' examples/react-vite-demo/app/src/generated-sdk.ts
grep -F 'Promise<User[]>' examples/react-vite-demo/app/src/generated-sdk.ts
```

若 `nx-mk run` 在 demo 目录失败（插件解析/配置问题），排查修复后再跑 —— 不允许跳过本步。

- [ ] **Step 6: demo typecheck**

Run: `corepack pnpm demo:typecheck`
Expected: PASS（UserProfile 消费生成类型无报错）

- [ ] **Step 7: README / gitignore 收尾**

7a. `.gitignore` 的 `# Runtime artifacts` 段 `.mk/` 下追加一行 `.nx-mk/`。

7b. 根 `README.md`「当前状态」段替换为：

```markdown
## 当前状态

**Phase 1.5 完成** — SDK Facade Codegen（SDK-CG1/CG2/CG3）+ demo 闭环打通。
下一步：Phase 2 采集（runtime proxy / collector / Playwright / SQLite trace store / UI evidence v0）。

demo 闭环：`pnpm demo:codegen` 一键跑 `demo:openapi` → `nx-mk run`（plugin-swagger → manifest.json）→ codegen → `app/src/generated-sdk.ts`。存量代码迁移：`npx nx-mk migrate`（静态 fetch 替换）+ `patchGlobalFetch()`（兜底）。
```

7c. `examples/react-vite-demo/README.md` 追加「运行闭环」小节（三步：`pnpm demo:openapi`、demo 目录 `node ../../packages/cli/dist/index.js run`、`pnpm exec tsx generate-sdk.ts` 或一键 `pnpm demo:codegen`；再加 migrate 演示：demo 目录 `node ../../packages/cli/dist/index.js migrate --dry-run`）。

- [ ] **Step 8: 全量回归**

```bash
npx vitest run
corepack pnpm --filter @nx-mk/kernel typecheck && corepack pnpm --filter @nx-mk/client typecheck && corepack pnpm --filter @nx-mk/cli typecheck
```

Expected: 全部测试通过（预计 ~180+）、typecheck 全绿。

- [ ] **Step 9: Commit**

```bash
git add examples/react-vite-demo README.md .gitignore package.json
git commit -m "feat(demo): close Phase 1.5 loop — real OpenAPI to typed SDK pipeline; docs + gitignore

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review 结论

- **Spec 覆盖**：spec §3.1→Task 1、§3.2→Task 1、§3.3→Task 2、§3.4→Task 3/4、§3.5→Task 5、§3.6→Task 6、§3.7→Task 8、§1.2-6 集成测试→Task 7、§4 错误处理→Task 6 实现、G 收尾→Task 8。无缺口。
- **占位扫描**：无 TBD/“适当处理”类占位；所有代码步骤给出完整代码。
- **类型一致性**：`migrateCodemod` 签名在 Task 3（定义）/Task 6（消费）/Task 7（消费）一致；`patchGlobalFetch` 签名 Task 5 内一致；`SchemaRef.items` Task 1 定义 → Task 2/7 消费一致；`runMigrate(opts)` Task 6 定义与 index dispatch 一致。
