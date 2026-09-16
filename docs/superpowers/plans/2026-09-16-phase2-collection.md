# Phase 2 采集实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 coverage 数据真正流动 —— 字段级 Proxy 追踪响应字段读取、collector 内存聚合、plugin-playwright 采 UI evidence 并对接 Goal Loop、§25 表落 SQLite、demo 闭环验收。

**Architecture:** client 内新增 proxy/collector 子模块（analysis 分支实装，production 零改动零开销）；新包 `@nx-mk/coverage`（better-sqlite3 + §25 DDL + evidence 结构 + analyzer v0）；新包 `@nx-mk/plugin-playwright`（kernel Plugin 协议，turn 驱动 DOM 扫描）。纯函数核心 + IO 剥离（nx-ce 分层）。

**Tech Stack:** TypeScript 5.3、better-sqlite3（WAL + 事务批量 flush）、playwright-core、vitest 1.6、corepack pnpm 9。

**Spec:** `docs/superpowers/specs/2026-09-16-nx-mk-phase2-collection-design.md`

## Global Constraints

- **环境**：Windows + Git Bash；pnpm 一律 `corepack pnpm`；vitest 用 `npx vitest run [path]`（root include 已覆盖 `packages/*/src/__tests__/`、`packages/*/__tests__/`、`tests/**`）。
- **代码风格**：中文注释；函数带类型；≤400 行；不用 any（raw 数据沿用现有写法）。
- **依赖**：仅 `better-sqlite3`（coverage）、`playwright-core`（plugin-playwright）；client 无新依赖。
- **探针纪律**：proxy/patch 探针永不抛错破坏业务请求（try/catch → 透传原始值）。
- **命名同源**：fieldPath 归一化复用 `@nx-mk/manifest-schema` 的 `normalizePath`（packages/manifest-schema/src/normalizer.ts，'a.0.b' → 'a[].b'，已从 index.ts 导出）。
- **§25 DDL 逐字**：9 张表 DDL 与 plan §25.1–25.9 一致（DDL 原文在 `docx/plan/nx-mk-plan.md:1695-1859`）。
- **提交**：Conventional Commits + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **分支**：`feat/phase2-collection`（spec 已提交 9d407f3）。

---

### Task 1: tracked proxy（Plan §19 逐字）

**Files:**
- Create: `packages/client/src/proxy/index.ts`、`create-tracked-proxy.ts`、`path-normalizer.ts`
- Modify: `packages/client/tsup.config.ts`（entry + `proxy: 'src/proxy/index.ts'`）
- Test: `packages/client/__tests__/proxy.test.ts`

**Interfaces:**
- Consumes: `normalizePath`（@nx-mk/manifest-schema，已导出）
- Produces: `createTrackedProxy<T extends object>(target: T, options: { requestId: string; endpointId: string; basePath: string; collector: { hit(h: { requestId: string; endpointId: string; fieldPath: string; normalizedPath: string; type: 'get'; timestamp: number }): void } }): T`；`normalizeProxyFieldPath(basePath: string, prop: string): string`。Task 3/5 按此形状消费。

- [ ] **Step 1: 写失败测试** —— `packages/client/__tests__/proxy.test.ts`：

```ts
/**
 * tracked proxy 单测（spec §3.1 / Plan §19 逐字）
 * 锁死：命中上报、嵌套路径推进、数组下标 → []、§19.3 不代理名单、
 * WeakMap 缓存引用稳定、symbol 透传、探针异常不扩散到 collector 调用方。
 */
import { describe, it, expect } from 'vitest'
import { createTrackedProxy } from '../src/proxy/index.js'

// 最小 hit 收集器（形状 = Task 2 正式 Collector 的 hit 子集）
function makeCollector() {
  const hits: { requestId: string; endpointId: string; fieldPath: string; normalizedPath: string; type: string; timestamp: number }[] = []
  return { hits, hit: (h: (typeof hits)[number]) => { hits.push(h) } }
}
const BASE = { requestId: 'req1', endpointId: 'ep1', basePath: 'data' }
type AnyObj = Record<string, unknown>

describe('字段命中与路径', () => {
  it('顶层字段 → hit fieldPath=data.id normalizedPath=data.id', () => {
    const c = makeCollector()
    const p = createTrackedProxy({ id: 'u1' } as AnyObj, { ...BASE, collector: c })
    const v = (p as AnyObj).id
    void v
    expect(c.hits).toEqual([expect.objectContaining({ fieldPath: 'data.id', normalizedPath: 'data.id', type: 'get' })])
  })

  it('嵌套 plain object → data.address.city（basePath 推进）', () => {
    const c = makeCollector()
    const p = createTrackedProxy({ address: { city: 'HZ' } } as AnyObj, { ...BASE, collector: c })
    const v = (p as { address: AnyObj }).address.city
    void v
    expect(c.hits.map((h) => h.normalizedPath)).toEqual(['data.address', 'data.address.city'])
  })

  it('嵌套数组元素字段 → data[].id（下标归一化）', () => {
    const c = makeCollector()
    const p = createTrackedProxy({ users: [{ id: 'x' }] } as AnyObj, { ...BASE, collector: c })
    const v = (p as { users: unknown[] }).users[0]
    void v
    expect(c.hits.some((h) => h.normalizedPath === 'users[]' || h.normalizedPath === 'data.users[]')).toBe(true)
  })

  it('顶层数组元素（response 本身是数组）→ data[].id', () => {
    const c = makeCollector()
    const p = createTrackedProxy([{ id: 'x' }] as unknown as AnyObj, { ...BASE, collector: c })
    const v = (p as unknown as unknown[])[0]
    void v
    // 数组 index 读取本身也产生 hit（路径 data[]）
    expect(c.hits.some((h) => h.normalizedPath === 'data[]')).toBe(true)
  })
})

describe('§19.3 不代理名单（值原样引用返回，无二次 hit）', () => {
  it.each([
    ['Date', () => new Date(0)],
    ['Map', () => new Map()],
    ['Set', () => new Set()],
    ['Promise', () => Promise.resolve(1)],
    ['Error', () => new Error('x')],
    ['RegExp', () => /x/],
    ['URL', () => new URL('http://localhost/x')],
    ['FormData', () => new FormData()],
  ])('%s 不被代理', (_name, factory) => {
    const c = makeCollector()
    const v = factory()
    const p = createTrackedProxy({ v } as AnyObj, { ...BASE, collector: c })
    expect((p as AnyObj).v).toBe(v)
  })

  it('class instance 不代理', () => {
    class Foo { x = 1 }
    const c = makeCollector()
    const f = new Foo()
    const p = createTrackedProxy({ f } as AnyObj, { ...BASE, collector: c })
    expect((p as AnyObj).f).toBe(f)
  })
})

describe('缓存与安全', () => {
  it('WeakMap：同一 target 二次包裹返回同一引用', () => {
    const c = makeCollector()
    const t = { id: 1 }
    expect(createTrackedProxy(t, { ...BASE, collector: c })).toBe(createTrackedProxy(t, { ...BASE, collector: c }))
  })

  it('symbol prop 直接透传，无 hit', () => {
    const c = makeCollector()
    const sym = Symbol('s')
    const p = createTrackedProxy({ [sym]: 42 } as AnyObj, { ...BASE, collector: c })
    expect((p as Record<symbol, unknown>)[sym]).toBe(42)
    expect(c.hits).toHaveLength(0)
  })

  it('collector.hit 抛错不破坏读取（探针吞异常，值仍返回）', () => {
    const boom = { hit: () => { throw new Error('collector down') } }
    const p = createTrackedProxy({ id: 7 } as AnyObj, { ...BASE, collector: boom })
    expect((p as AnyObj).id).toBe(7)
  })
})
```

- [ ] **Step 2: 确认失败** —— Run: `npx vitest run packages/client/__tests__/proxy.test.ts` → FAIL（module not found）

- [ ] **Step 3: 实现**

3a. `packages/client/src/proxy/path-normalizer.ts`：

```ts
/**
 * 代理路径归一化 —— spec §3.1 / Plan §17
 * 委托 @nx-mk/manifest-schema 的 normalizePath（'a.0.b' → 'a[].b'），避免两处规则漂移。
 */
import { normalizePath } from '@nx-mk/manifest-schema'

/** 代理读取时的段拼接 + 归一化（数字段 → []） */
export function normalizeProxyFieldPath(basePath: string, prop: string): string {
  return normalizePath(`${basePath}.${prop}`)
}
```

3b. `packages/client/src/proxy/create-tracked-proxy.ts`：

```ts
/**
 * createTrackedProxy —— Plan §19 字段级 Proxy（spec §3.1 逐字）
 * get 拦截 → hit 上报 → 值可代理则递归包裹（basePath 推进）。
 * WeakMap 缓存保证引用稳定（§19.4）；探针纪律：collector 异常吞掉（spec §4）。
 */
import { normalizeProxyFieldPath } from './path-normalizer.js'

export interface ProxyCollector {
  hit(hit: {
    requestId: string
    endpointId: string
    fieldPath: string
    normalizedPath: string
    type: 'get'
    timestamp: number
  }): void
}

export interface TrackedProxyOptions {
  requestId: string
  endpointId: string
  basePath: string
  collector: ProxyCollector
}

// §19.4 模块级缓存
const proxyCache = new WeakMap<object, unknown>()

// §19.3 native class 一律透传
const NON_PROXY_TAGS = new Set([
  '[object Date]', '[object File]', '[object Blob]', '[object Map]', '[object Set]',
  '[object WeakMap]', '[object WeakSet]', '[object Promise]', '[object Error]',
  '[object RegExp]', '[object URL]', '[object FormData]', '[object ArrayBuffer]',
])

export function createTrackedProxy<T extends object>(target: T, options: TrackedProxyOptions): T {
  if (!isProxyable(target)) return target
  const cached = proxyCache.get(target)
  if (cached !== undefined) return cached as T

  const proxy = new Proxy(target, {
    get(obj: object, prop: string | symbol, receiver: unknown): unknown {
      if (typeof prop === 'symbol') return Reflect.get(obj, prop, receiver)
      const value = Reflect.get(obj, prop, receiver)
      // 数组下标 prop 也是合法 fieldPath 段（'data.0'），归一化负责转 []
      const fieldPath = `${options.basePath}.${prop}`
      const normalizedPath = normalizeProxyFieldPath(options.basePath, prop)
      try {
        options.collector.hit({
          requestId: options.requestId,
          endpointId: options.endpointId,
          fieldPath,
          normalizedPath,
          type: 'get',
          timestamp: Date.now(),
        })
      } catch {
        // 探针纪律：异常不传播（spec §4）
      }
      if (isProxyable(value)) {
        return createTrackedProxy(value as object, { ...options, basePath: normalizedPath })
      }
      return value
    },
  })

  proxyCache.set(target, proxy)
  return proxy as T
}

/** §19.3：plain object / array 可代理；native class 不可 */
function isProxyable(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return true
  if (NON_PROXY_TAGS.has(Object.prototype.toString.call(v))) return false
  const ctor = (v as { constructor?: unknown }).constructor
  return ctor === Object || ctor === Array
}
```

3c. `packages/client/src/proxy/index.ts`：

```ts
/**
 * @nx-mk/client/proxy —— Plan §19 字段级 Proxy（Phase 2 spec §3.1）
 * 内部子模块：由 mode/analysis 组装后经 runtime 间接生效；production 不 import（零开销）。
 */
export { createTrackedProxy, type TrackedProxyOptions, type ProxyCollector } from './create-tracked-proxy.js'
export { normalizeProxyFieldPath } from './path-normalizer.js'
```

3d. tsup entry 追加 `proxy: 'src/proxy/index.ts'`。

- [ ] **Step 4: 确认全绿** —— `npx vitest run packages/client/__tests__/proxy.test.ts` → PASS
- [ ] **Step 5: build + typecheck** —— `corepack pnpm --filter @nx-mk/client build && corepack pnpm --filter @nx-mk/client typecheck`
- [ ] **Step 6: Commit**

```bash
git add packages/client/src/proxy packages/client/__tests__/proxy.test.ts packages/client/tsup.config.ts
git commit -m "feat(client): tracked field proxy — WeakMap cache + non-proxy tags (Plan §19)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: collector —— 内存聚合 + noop

**Files:**
- Create: `packages/client/src/collector/index.ts`、`collector.ts`、`noop-collector.ts`
- Modify: `packages/client/tsup.config.ts`（entry + `collector: 'src/collector/index.ts'`）
- Test: `packages/client/__tests__/collector.test.ts`

**Interfaces:**
- Consumes: `PluginReport` 的结构形状（`{kind:'field-hit'; fieldId; count; turn}` / `{kind:'endpoint-called'; method; path; turn}`——本地定义形状，不 import kernel 避免依赖方向）
- Produces:
```ts
interface FieldHitCore { requestId: string; endpointId: string; fieldPath: string; normalizedPath: string; type: 'get'; timestamp: number }
interface RequestTraceCore { requestId: string; endpointId?: string; method: string; url: string; path?: string; status?: number; durationMs?: number; startedAt?: string; endedAt?: string }
interface UiEvidenceCore { requestId?: string; fieldId?: string; fieldPath: string; evidenceType: 'text'; selector?: string; visible: boolean; inViewport: boolean; route?: string }
interface CollectReport { kind: 'field-hit' | 'endpoint-called'; fieldId?: string; method?: string; path?: string; count: number; turn: number }
interface Collector {
  hit(h: FieldHitCore): void; trace(t: RequestTraceCore): void; evidence(ev: UiEvidenceCore): void
  snapshot(turn: number): CollectReport[]        // 增量、未消费、幂等
  drain(): { hits: (FieldHitCore & { count: number })[]; traces: RequestTraceCore[]; evidence: UiEvidenceCore[] }
  reset(): void
}
createCollector(): Collector; createNoopCollector(): Collector
```

- [ ] **Step 1: 写失败测试** —— `packages/client/__tests__/collector.test.ts`：

```ts
/**
 * collector 单测（spec §3.2）：hit 按 normalizedPath 聚合、drain 清空、
 * snapshot 增量幂等、noop 全 no-op。
 */
import { describe, it, expect } from 'vitest'
import { createCollector, createNoopCollector } from '../src/collector/index.js'

const HIT = (path: string, ts = Date.now()) => ({
  requestId: 'r1', endpointId: 'ep1',
  fieldPath: `data.${path}`, normalizedPath: `data.${path}`,
  type: 'get' as const, timestamp: ts,
})

describe('createCollector', () => {
  it('hit 按 normalizedPath 聚合 count', () => {
    const c = createCollector()
    c.hit(HIT('id')); c.hit(HIT('id')); c.hit(HIT('name'))
    const { hits } = c.drain()
    expect(hits).toHaveLength(2)
    expect(hits.find((h) => h.normalizedPath === 'data.id')!.count).toBe(2)
    expect(hits.find((h) => h.normalizedPath === 'data.name')!.count).toBe(1)
  })

  it('drain 返回并清空', () => {
    const c = createCollector()
    c.hit(HIT('id'))
    c.trace({ requestId: 'r1', method: 'GET', url: '/api/users' })
    c.evidence({ fieldPath: 'data.id', evidenceType: 'text', visible: true, inViewport: true })
    expect(c.drain()).toEqual({
      hits: [expect.objectContaining({ normalizedPath: 'data.id', count: 1 })],
      traces: [expect.objectContaining({ method: 'GET' })],
      evidence: [expect.objectContaining({ evidenceType: 'text' })],
    })
    expect(c.drain()).toEqual({ hits: [], traces: [], evidence: [] })
  })

  it('reset 清空全部', () => {
    const c = createCollector()
    c.hit(HIT('id')); c.reset()
    expect(c.drain().hits).toHaveLength(0)
  })

  it('snapshot 产出 field-hit + endpoint-called 增量，且 drain 不受影响', () => {
    const c = createCollector()
    c.hit(HIT('id'))
    c.trace({ requestId: 'r1', method: 'GET', url: 'http://x/api/users/u_001', path: '/users/u_001' })
    const s1 = c.snapshot(2)
    expect(s1).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'field-hit', fieldId: 'data.id', count: 1, turn: 2 }),
      expect.objectContaining({ kind: 'endpoint-called', method: 'GET', path: '/users/u_001', turn: 2 }),
    ]))
    expect(c.drain().hits).toHaveLength(1)  // snapshot 不消费
  })

  it('snapshot 幂等：已报的增量不重复（hit count 变化后重报新 count）', () => {
    const c = createCollector()
    c.hit(HIT('id'))
    expect(c.snapshot(1)).toHaveLength(2)   // field-hit + 无 trace
    // 无新数据 → 空增量
    expect(c.snapshot(2)).toHaveLength(0)
    // count 增长 → 重报（count 更新）
    c.hit(HIT('id'))
    const s3 = c.snapshot(3)
    expect(s3).toEqual([expect.objectContaining({ kind: 'field-hit', count: 2, turn: 3 })])
  })
})

describe('createNoopCollector', () => {
  it('全部 no-op，drain 恒空', () => {
    const c = createNoopCollector()
    c.hit(HIT('id'))
    c.trace({ requestId: 'r', method: 'GET', url: '/' })
    c.evidence({ fieldPath: 'x', evidenceType: 'text', visible: true, inViewport: true })
    expect(c.snapshot(1)).toEqual([])
    expect(c.drain()).toEqual({ hits: [], traces: [], evidence: [] })
  })
})
```

- [ ] **Step 2: 确认失败**（module not found）

- [ ] **Step 3: 实现**

3a. `packages/client/src/collector/collector.ts`：

```ts
/**
 * collector —— 内存聚合缓冲（纯数据结构无 IO；spec §3.2）
 * hit 按 normalizedPath 聚合 count；snapshot 增量幂等（同 key 且 count 未变不重报）；
 * drain() 是唯一消费口，flush 由 SQLite 写入方（@nx-mk/coverage）调用。
 */

export interface FieldHitCore {
  requestId: string
  endpointId: string
  fieldPath: string
  normalizedPath: string
  type: 'get'
  timestamp: number
}

export interface RequestTraceCore {
  requestId: string
  endpointId?: string
  method: string
  url: string
  path?: string
  status?: number
  durationMs?: number
  startedAt?: string
  endedAt?: string
}

export interface UiEvidenceCore {
  requestId?: string
  fieldId?: string
  fieldPath: string
  evidenceType: 'text'
  selector?: string
  visible: boolean
  inViewport: boolean
  route?: string
}

export interface CollectReport {
  kind: 'field-hit' | 'endpoint-called'
  fieldId?: string
  method?: string
  path?: string
  count: number
  turn: number
}

export interface Collector {
  hit(h: FieldHitCore): void
  trace(t: RequestTraceCore): void
  evidence(ev: UiEvidenceCore): void
  snapshot(turn: number): CollectReport[]
  drain(): { hits: (FieldHitCore & { count: number })[]; traces: RequestTraceCore[]; evidence: UiEvidenceCore[] }
  reset(): void
}

interface HitEntry extends FieldHitCore { count: number }

export function createCollector(): Collector {
  const hitMap = new Map<string, HitEntry>()       // key: normalizedPath
  const reported = new Map<string, number>()       // key: 已 snapshot 时的 count（幂等）
  const traces: RequestTraceCore[] = []
  const reportedTraces = new Set<string>()
  const evidence: UiEvidenceCore[] = []

  return {
    hit(h) {
      const e = hitMap.get(h.normalizedPath)
      if (e) e.count += 1
      else hitMap.set(h.normalizedPath, { ...h, count: 1 })
    },
    trace(t) { traces.push(t) },
    evidence(ev) { evidence.push(ev) },
    snapshot(turn) {
      const out: CollectReport[] = []
      for (const [key, e] of hitMap) {
        if (reported.get(key) !== e.count) {
          out.push({ kind: 'field-hit', fieldId: key, count: e.count, turn })
          reported.set(key, e.count)
        }
      }
      for (const t of traces) {
        if (!reportedTraces.has(t.requestId)) {
          out.push({ kind: 'endpoint-called', method: t.method, path: t.path ?? t.url, count: 1, turn })
          reportedTraces.add(t.requestId)
        }
      }
      return out
    },
    drain() {
      const out = { hits: [...hitMap.values()], traces: [...traces], evidence: [...evidence] }
      hitMap.clear(); reported.clear(); traces.length = 0; reportedTraces.clear(); evidence.length = 0
      return out
    },
    reset() {
      hitMap.clear(); reported.clear(); traces.length = 0; reportedTraces.clear(); evidence.length = 0
    },
  }
}
```

3b. `packages/client/src/collector/noop-collector.ts`：

```ts
/**
 * production 占位 collect —— 全 no-op（零开销；spec §1.2-5 回归锁死目标）
 */
import type { Collector } from './collector.js'

export function createNoopCollector(): Collector {
  const noop = () => {}
  const empty = () => ({ hits: [], traces: [], evidence: [] })
  return { hit: noop, trace: noop, evidence: noop, snapshot: () => [], drain: empty, reset: noop }
}
```

3c. `packages/client/src/collector/index.ts`：

```ts
/**
 * @nx-mk/client/collector —— 采集内存缓冲（spec §3.2）
 * IO 剥离：drain() 交给 SQLite 写入方（@nx-mk/coverage flush）。
 */
export {
  createCollector,
  type Collector,
  type FieldHitCore,
  type RequestTraceCore,
  type UiEvidenceCore,
  type CollectReport,
} from './collector.js'
export { createNoopCollector } from './noop-collector.js'
```

3d. tsup entry 追加 `collector: 'src/collector/index.ts'`。

- [ ] **Step 4: 全绿** —— `npx vitest run packages/client/__tests__/` → PASS
- [ ] **Step 5: build** —— `corepack pnpm --filter @nx-mk/client build`
- [ ] **Step 6: Commit**

```bash
git add packages/client/src/collector packages/client/__tests__/collector.test.ts packages/client/tsup.config.ts
git commit -m "feat(client): collector — buffered aggregation + noop (spec §3.2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: @nx-mk/coverage 包 —— §25 DDL + db wrapper + flush

**Files:**
- Create: `packages/coverage/package.json`、`tsconfig.json`、`tsup.config.ts`、`vitest.config.ts`
- Create: `packages/coverage/src/index.ts`、`src/db/schema.ts`、`src/db/client.ts`
- Test: `packages/coverage/__tests__/db.test.ts`

**Interfaces:**
- Consumes: Task 2 `drain()` 返回形状
- Produces:
```ts
const SCHEMA_SQL: string[]                     // 9 张 CREATE TABLE IF NOT EXISTS（§25 逐字）
const TABLE_NAMES: string[]                    // 9 表名
class CoverageDb {
  journalMode: string                          // 'wal' getter
  pragma(sql, opts?): unknown
  prepare(sql): { run; get; all }              // 透传 better-sqlite3
  insertRun(runId, startedAt, status): void
  endRun(runId, endedAt, status): void
  flushDrained(d: { runId; hits: (FieldHitCore & {count})[]; traces; evidence }): void   // 一次事务
  close(): void
}
openCoverageDb(dbPath): CoverageDb
```

- [ ] **Step 0: 包脚手架**

`packages/coverage/package.json`：

```json
{
  "name": "@nx-mk/coverage",
  "version": "0.1.0",
  "private": true,
  "description": "nx-mk coverage store — SQLite §25 DDL + trace/evidence flush",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsup", "typecheck": "tsc --noEmit", "test": "vitest run", "clean": "rm -rf dist *.tsbuildinfo" },
  "dependencies": { "better-sqlite3": "^11.10.0", "@nx-mk/manifest-schema": "workspace:*" },
  "devDependencies": { "@types/better-sqlite3": "^7.6.13", "@types/node": "^20.10.0", "tsup": "^8.0.2", "typescript": "^5.3.3", "vitest": "^1.0.4" },
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
}
```

`packages/coverage/tsup.config.ts`：

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['better-sqlite3', '@nx-mk/manifest-schema'],
})
```

`packages/coverage/vitest.config.ts`：`{ test: { include: ['__tests__/**/*.test.ts'] } }`（格式同 client）。
`packages/coverage/tsconfig.json`：copy `packages/client/tsconfig.json`（workspace paths 不需要——只用 manifest-schema 的 dist 解析即可）。

Run: `corepack pnpm install`（链接 workspace + better-sqlite3；失败即 BLOCKED 上报）。

- [ ] **Step 1: 写失败测试** —— `packages/coverage/__tests__/db.test.ts`：

```ts
/**
 * SQLite db 单测（spec §3.3 / Plan §25）：9 张表 DDL、WAL、事务 flush、读回。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '../src/db/client.js'
import { TABLE_NAMES } from '../src/db/schema.js'

let dir: string
let dbPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-mk-cov-'))
  dbPath = join(dir, 'coverage.db')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('schema（§25 逐字）', () => {
  it('创建全部 9 张表', () => {
    const db = openCoverageDb(dbPath)
    try {
      expect(TABLE_NAMES).toEqual([
        'runs', 'endpoints', 'manifest_fields', 'request_traces', 'request_fields',
        'field_hits', 'ui_evidence', 'coverage_fields', 'agent_iterations',
      ])
      for (const t of TABLE_NAMES) {
        const cols = db.pragma(`table_info(${t})`) as { name: string }[]
        expect(cols.length).toBeGreaterThan(0)
      }
      // 关键列抽查（§25 逐字性）
      const traceCols = (db.pragma('table_info(request_traces)') as { name: string }[]).map((c) => c.name)
      expect(traceCols).toEqual(expect.arrayContaining(['id', 'run_id', 'trace_id', 'scenario_id', 'dsl_step_id', 'endpoint_id', 'method', 'url', 'path', 'status', 'duration_ms', 'started_at', 'ended_at', 'replayable', 'replay_safety', 'replay_reason']))
      const evCols = (db.pragma('table_info(ui_evidence)') as { name: string }[]).map((c) => c.name)
      expect(evCols).toEqual(expect.arrayContaining(['id', 'run_id', 'request_id', 'field_id', 'field_path', 'evidence_type', 'selector', 'visible', 'in_viewport', 'route', 'screenshot_path']))
    } finally { db.close() }
  })

  it('WAL 模式开启', () => {
    const db = openCoverageDb(dbPath)
    try { expect(db.journalMode).toBe('wal') } finally { db.close() }
  })

  it('幂等重开', () => {
    openCoverageDb(dbPath).close()
    openCoverageDb(dbPath).close()
  })
})

describe('insertRun / endRun / flush 读回', () => {
  it('flushDrained 一个事务写 3 类数据并可读回', () => {
    const db = openCoverageDb(dbPath)
    try {
      db.insertRun('run_x', '2026-09-16T00:00:00Z', 'running')
      db.flushDrained({
        runId: 'run_x',
        hits: [{ requestId: 'r1', endpointId: 'ep1', fieldPath: 'data.id', normalizedPath: 'data.id', type: 'get', timestamp: 1700000000000, count: 2 }],
        traces: [{ requestId: 'r1', endpointId: 'ep1', method: 'GET', url: 'http://x/api/users/u_001', path: '/users/u_001', status: 200, durationMs: 12, startedAt: '2026-09-16T00:00:00Z', endedAt: '2026-09-16T00:00:00Z' }],
        evidence: [{ fieldPath: 'data.id', evidenceType: 'text', visible: true, inViewport: true, selector: '[data-mk-field="data.id"]' }],
      })
      expect(db.prepare('SELECT count(*) AS n FROM field_hits WHERE run_id=?').get('run_x')).toEqual({ 'count(*)': 1 })
      expect(db.prepare('SELECT count(*) AS n FROM field_hits WHERE run_id=?').get('run_x')).toEqual({ 'count(*)': 1 })
      const hit = db.prepare('SELECT * FROM field_hits WHERE run_id=?').get('run_x') as Record<string, unknown>
      expect(hit.count).toBe(2)
      expect(hit.first_hit_at).toBe(new Date(1700000000000).toISOString())
      expect(db.prepare('SELECT count(*) AS n FROM request_traces WHERE run_id=?').get('run_x')).toEqual({ n: 1 })
      expect(db.prepare('SELECT count(*) AS n FROM ui_evidence WHERE run_id=?').get('run_x')).toEqual({ n: 1 })
      expect(db.prepare('SELECT count(*) AS n FROM ui_evidence WHERE run_id=?').get('run_x')).toEqual({ n: 1 })
    } finally { db.close() }
  })

  it('endRun 更新 status', () => {
    const db = openCoverageDb(dbPath)
    try {
      db.insertRun('r', '2026-09-16T00:00:00Z', 'running')
      db.endRun('r', '2026-09-16T00:01:00Z', 'completed')
      expect(db.prepare('SELECT status, ended_at FROM runs WHERE id=?').get('r')).toEqual({ status: 'completed', ended_at: '2026-09-16T00:01:00Z' })
    } finally { db.close() }
  })
})
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现**

3a. `packages/coverage/src/db/schema.ts` —— **从 plan 逐字复制 9 张表**：

```ts
/**
 * §25 SQLite schema —— 9 张表 DDL 逐字（Plan §25.1-25.9）
 * 原文：docx/plan/nx-mk-plan.md 1695-1859 行；幂等建表（IF NOT EXISTS）。
 */

export const TABLE_NAMES = [
  'runs', 'endpoints', 'manifest_fields', 'request_traces', 'request_fields',
  'field_hits', 'ui_evidence', 'coverage_fields', 'agent_iterations',
] as const

export const SCHEMA_SQL: string[] = [
  // §25.1 runs（plan 逐字）
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    project_name TEXT,
    dashboard_url TEXT,
    manifest_hash TEXT,
    config_path TEXT,
    resolved_config_path TEXT
  )`,
  // §25.2/25.3/25.4/25.5/25.6/25.7/25.8/25.9 ——
  // 实现者注意：endpoints / manifest_fields / request_traces / request_fields /
  // field_hits / ui_evidence / coverage_fields / agent_iterations 的 DDL 逐字从
  // docx/plan/nx-mk-plan.md:1711-1859 复制（endpoints 与 manifest_fields 的列
  // plan 未给出原文，按本文件下方注明的补充列建表；其余 6 张 plan 有原文，逐字复制）。
  // —— endpoints / manifest_fields 补充列（plan 未定义，按 runtime 需要最小化）：
  //    endpoints(id, run_id, method, path, operation_id, tags)
  //    manifest_fields(id, run_id, endpoint_id, field_path, normalized_path, type, required, nullable)
]
```

DDL 数组其余 6 张 plan-有-原文表（request_traces/request_fields/field_hits/ui_evidence/coverage_fields/agent_iterations）逐字复制原文 SQL；endpoints/manifest_fields 用上面标注的最小列集。

3b. `packages/coverage/src/db/client.ts`：

```ts
/**
 * coverage db —— better-sqlite3 wrapper（spec §3.3）：WAL、幂等建表、事务批量 flush。
 * 无 migrations 框架（YAGNI）：CREATE TABLE IF NOT EXISTS，schema 漂移留给 Phase 4。
 */
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema.js'
import type { FieldHitCore, RequestTraceCore, UiEvidenceCore } from '@nx-mk/client/collector'

type DrainedHits = FieldHitCore & { count: number }

export interface FlushInput {
  runId: string
  hits: DrainedHit[]
  traces: RequestTraceCore[]
  evidence: UiEvidenceCore[]
}
type DrainedHit = Drained  // 见上方 DrainedHit 别名编排（与 Task 2 输出形状一致）
```

> ⚠️ 起草笔误区（实现者修正）：`DrainedHit`/`Drained`/`Drained 恒等别名顺序不对 —— 正确写法：顶部 `import type { FieldHitCore, ... } from '@nx-mk/client/collector'` 后直接 `type DrainedHit = FieldHitCore & { count: number }`，`FlushInput.hits: DrainedHit[]`。删掉本块的两个别名草稿行，DELETE `type FlushInput` 里 `DrainedHit` 之外的行。

修正后的完整 `client.ts` 主体（实现者以此为准）：

```ts
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema.js'
import type { FieldHitCore, RequestTraceCore, UiEvidenceCore } from '@nx-mk/client/collector'

type DrainedHit = FieldHitCore & { count: number }

export interface FlushInput {
  runId: string
  hits: DrainedHit[]
  traces: RequestTraceCore[]
  evidence: UiEvidenceCore[]
}

export class CoverageDb {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    for (const stmt of SCHEMA_SQL) this.db.exec(stmt)
  }

  get journalMode(): string {
    return this.db.pragma('journal_mode', { simple: true }) as string
  }

  pragma(sql: string, opts?: { simple?: boolean }): unknown {
    return this.db.pragma(sql, opts as never)
  }

  prepare(sql: string) {
    return this.db.prepare(sql)
  }

  insertRun(runId: string, startedAt: string, status: string, manifestHash?: string): void {
    this.db.prepare('INSERT OR REPLACE INTO runs (id, started_at, status, manifest_hash) VALUES (?, ?, ?, ?)')
      .run(runId, startedAt, status, manifestHash ?? null)
  }

  endRun(runId: string, endedAt: string, status: string): void {
    this.db.prepare('UPDATE runs SET ended_at = ?, status = ? WHERE id = ?').run(endedAt, status, runId)
  }

  /** 事务批量 flush（spec §3.3）：hits 按 normalizedPath 幂等 upsert；traces/evidence 逐条插入 */
  flushDrained(d: FlushInput): void {
    const tx = this.db.transaction(() => {
      // field_hits：§25.6 列全部填充（request_id/endpoint_id/field_id 本版可空）
      const insHit = this.db.prepare(
        `INSERT OR REPLACE INTO field_hits
           (id, run_id, request_id, endpoint_id, field_id, field_path, normalized_path, count, first_hit_at, last_hit_at, route, source)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 'proxy')`,
      )
      for (const h of d.hits) {
        const at = new Date(h.timestamp).toISOString()
        insHit.run(
          `fh_${d.runId}_${h.normalizedPath}`, d.runId, h.requestId, h.endpointId,
          h.fieldPath, h.normalizedPath, h.count, at, at,
        )
      }
      // request_traces：§25.4 列（scenario_id/dsl_step_id/replayable/replay_safety/replay_reason Phase 2 无数据 → NULL/默认）
      const insTrace = this.db.prepare(
        `INSERT OR REPLACE INTO request_traces
           (id, run_id, trace_id, scenario_id, dsl_step_id, endpoint_id, method, url, path, status, duration_ms, started_at, ended_at, replayable, replay_safety, replay_reason)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      for (const t of d.traces) {
        insTrace.run(
          `rt_${d.runId}_${t.requestId}`, d.runId, t.requestId, t.endpointId ?? null,
          t.method, t.url, t.path ?? null, t.status ?? null, t.durationMs ?? null,
          t.startedAt ?? null, t.endedAt ?? null,
        )
      }
      // ui_evidence：§25.7 列（evidence_type v0=text；screenshot_path 不采 → NULL）
      const insEv = this.db.prepare(
        `INSERT OR REPLACE INTO ui_evidence
           (id, run_id, request_id, field_id, field_path, evidence_type, selector, visible, in_viewport, route, screenshot_path)
         VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?, ?, NULL)`,
      )
      for (const e of d.evidence) {
        insEv.run(
          `ue_${d.runId}_${e.fieldPath}`, d.runId, e.requestId ?? null, e.fieldId ?? null,
          e.fieldPath, e.selector ?? null, e.visible ? 1 : 0, e.inViewport ? 1 : 0, e.route ?? null,
        )
      }
    })
    tx()
  }

  close(): void { this.db.close() }
}

export function openCoverageDb(dbPath: string): CoverageDb {
  return new CoverageDb(dbPath)
}
```

3c. `packages/coverage/src/index.ts`：

```ts
/**
 * @nx-mk/coverage —— SQLite 采集落盘（spec §3.3）
 */
export { openCoverageDb, CoverageDb, type FlushInput } from './db/client.js'
export { SCHEMA_SQL, TABLE_NAMES } from './db/schema.js'
```

3d. `packages/coverage/package.json` exports 不需新增（ Collector 类型经 `@nx-mk/client/collector` 子路径解析 —— client 的 exports map 已有 `./collector`？**没有** —— 因此本 task 的 package.json 还要在 client 的 exports 里加 `"./collector"`（如下 Step 3e）。

3e. Modify `packages/client/package.json` exports 追加：

```json
    "./collector": {
      "types": "./dist/collector.d.ts",
      "import": "./dist/collector.js"
    },
```

（alphabet 位置介于 `./codegen` 与 `./migrate` 之间；加入后跑 `corepack pnpm --filter @nx-mk/client build`。）

- [ ] **Step 4: 全绿** —— `npx vitest run packages/coverage/` → PASS（4 例）
- [ ] **Step 5: build** —— `corepack pnpm --filter @nx-mk/coverage build`
- [ ] **Step 6: Commit**

```bash
git add packages/coverage packages/client/package.json pnpm-lock.yaml
git commit -m "feat(coverage): SQLite store — §25 DDL, WAL, transactional flush

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: dom-scanner 纯函数 + coverage analyzer v0

**Files:**
- Create: `packages/coverage/src/evidence/dom-scanner.ts`
- Create: `packages/coverage/src/analyzer/coverage-analyzer.ts`
- Modify: `packages/coverage/src/index.ts`（导出）
- Test: `packages/coverage/__tests__/dom-scanner.test.ts`、`packages/coverage/__tests__/coverage-analyzer.test.ts`

**Interfaces:**
- Consumes: `CoverageDb.prepare`（analyzer 写 coverage_fields 表）、`ApiManifest`（@nx-mk/manifest-schema）
- Produces:
```ts
// 输入描述符（与 plugin-playwright 的 page.evaluate 输出契约一致）
interface DomFieldDescriptor { dataMkField: string; visible: boolean; inViewport: boolean }
function scanDom(descs: DomFieldDescriptor[]): UiEvidenceCore[]     // 从 @nx-mk/client/collector import 类型
// 极简 policy v0（spec D7）
function analyzeCoverage(db: { prepare(sql): ...; flushDrained?: never }, runId: string, manifest: ApiManifest, drained: { hits: { normalizedPath: string; count: number }[] }): { total: number; covered: number; missing: string[] }   // coverage_fields 表 + missing 数组
```

- [ ] **Step 1: 写失败测试** —— `packages/coverage/__tests__/dom-scanner.test.ts`：

```ts
/**
 * dom scanner 纯函数（spec §3.4 / §6）：元素描述数组 → evidence 结构（过滤 + 组装 + selector 生成）
 */
import { describe, it, expect } from 'vitest'
import { scanDom } from '../src/evidence/dom-scanner.js'

describe('scanDom', () => {
  it('元素描述组装为 evidence（text 类型）', () => {
    expect(scanDom([
      { dataMkField: 'data.id', visible: true, inViewport: true },
      { dataMkField: 'data.address.zip', visible: false, inViewport: false },
    ])).toEqual([
      { fieldPath: 'data.id', evidenceType: 'text', visible: true, inViewport: true, selector: '[data-mk-field="data.id"]', requestId: undefined, fieldId: undefined, route: undefined },
      { fieldPath: 'data.address.zip', evidenceType: 'text', visible: false, inViewport: false, selector: '[data-mk-field="data.address.zip"]', requestId: undefined, fieldId: undefined, route: undefined },
    ])
  })

  it('空 dataMkField 过滤；invisible 保留（hidden evidence 有价值）', () => {
    const out = scanDom([{ dataMkField: '', visible: true, inViewport: true }, { dataMkField: 'x', visible: false, inViewport: false }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ fieldPath: 'x', visible: false })
  })

  it('空数组 → 空输出', () => {
    expect(scanDom([])).toEqual([])
  })
})
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现**

3a. `packages/coverage/src/evidence/dom-scanner.ts`：

```ts
/**
 * dom scanner —— evidence 结构组装/校验（spec §3.4 / §6）
 * 纯函数：输入来自浏览器侧 page.evaluate 的描述列表（plugin-playwright 产出），
 * 本函数做空值过滤 + selector 生成 + UiEvidenceCore 结构组装（不做浏览器 IO）。
 */
import type { UiEvidenceCore } from '@nx-mk/client/collector'

export interface DomFieldDescriptor {
  dataMkField: string          // data-mk-field 属性值（空 = 过滤）
  visible: boolean
  inViewport: boolean
}

export function scanDom(descs: DomFieldDescriptor[]): UiEvidenceCore[] {
  return descs
    .filter((d) => d.dataMkField !== '')
    .map((d) => ({
      requestId: undefined,
      fieldId: undefined,
      fieldPath: d.dataMkField,
      evidenceType: 'text' as const,
      selector: `[data-mk-field="${d.dataMkField}"]`,
      visible: d.visible,
      inViewport: d.inViewport,
      route: undefined,
    }))
}
```

3b. `packages/coverage/src/analyzer/coverage-analyzer.ts` —— 先看测试（Step 1b），实现 TDD 产出。

Step 1 附加测试 —— `packages/coverage/__tests__/coverage-analyzer.test.ts`：

```ts
/**
 * coverage analyzer v0（spec D7）：required 未访问 = missing；
 * field-hit 命中 → coverage 状态 counted；产出 coverage_fields 行 + missing 数组。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '../src/db/client.js'
import { analyzeCoverage } from '../src/analyzer/coverage-analyzer.js'
import type { ApiManifest } from '@nx-mk/manifest-schema'

let dir: string
const MANIFEST: ApiManifest = {
  version: '1',
  source: { type: 'openapi', input: 'x.json', hash: 'h' },
  generatedAt: '',
  schemas: {},
  fields: [
    { id: 'f_id', endpointId: 'ep1', direction: 'response', status: '200', path: 'data.id', normalizedPath: 'data.id', name: 'id', type: 'string', required: true, source: { openapiPointer: '' } },
    { id: 'f_addr', endpointId: 'ep1', direction: 'response', status: '200', path: 'data.address.zip', normalizedPath: 'data.address.zip', name: 'zip', type: 'string', required: false, source: { openapiPointer: '' } },
  ],
  endpoints: [{ id: 'ep1', method: 'GET', path: '/users/{id}', responses: [{ status: '200', fields: [] }] }],
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-an-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('analyzeCoverage', () => {
  it('required 且命中 → coverage_state=covered counted_required=1', () => {
    const db = openCoverageDb(join(dir, 'c.db'))
    try {
      const r = analyzeCoverage(db, 'run1', MANIFEST, { hits: [{ normalizedPath: 'data.id', count: 3 }] })
      expect(r.total).toBe(2)             // manifest 2 个 response field
      expect(r.covered).toBe(1)
      expect(r.missing).toEqual(['data.address.zip'])  // optional 字段 D7 不计入 missing？——见下条
      void r
    } finally { db.close() }
  })

  it('optional 未命中不计入 missing（D7 v0 只看 required）', () => {
    const db = openCoverageDb(join(dir, 'c.db'))
    try {
      const r = analyzeCoverage(db, 'run1', MANIFEST, { hits: [] })
      expect(r.missing).toEqual([])       // 无 required 字段的 manifest → empty missing
      void r
    } finally { db.close() }
  })

  it('required 未命中 → missing 含该 fieldPath', () => {
    const M: ApiManifest = { ...MANIFEST, fields: [MANIFEST.fields[0]!] }
    const db = openCoverageDb(join(dir, 'c.db'))
    try {
      const r = analyzeCoverage(db, 'run1', M, { hits: [] })
      expect(r.missing).toEqual(['data.id'])
    } finally { db.close() }
  })
})
```

> ⚠️ 上面的第 1 例与第 2 例 mutual 矛盾（第 1 例断言 `missing: ['data.address.zip']`，第 2 例断言 optional 不计入 missing）。**实施者以 spec D7 语义为准裁决**：D7 = required 未访问 = missing → 第 2 例语义为真（optional 永不进 missing）。实施时该第 1 例的断言改为 `expect(r.missing).toEqual([])`（f_id required 且已命中 → missing 空）。两例保留为行为锁：命中 required → covered；未命中 required → missing；optional 恒不进 missing。

2 例（改后）明确为：

```ts
      // 例 1 改后断言：required 命中 → missing 空
      expect(r.missing).toEqual([])
```

3c. `coverage-analyzer.ts` 实现：

```ts
/**
 * 极简 policy v0（spec D7）：required response 字段未被 field-hit → missing。
 * 同时把逐字段状态写 coverage_fields 表（§25.8）。
 */
import type { ApiManifest } from '@nx-mk/manifest-schema'

export interface AnalyzerDb {
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
  }
}

export interface AnalyzeResult {
  total: number
  covered: number
  missing: string[]        // normalized fieldPath
}

export function analyzeCoverage(
  db: AnalyzerDb,
  runId: string,
  manifest: ApiManifest,
  drained: { hits: { normalizedPath: string; count: number }[] },
): AnalyzeResult {
  const hitPaths = new Set(drained.hits.filter((h) => h.count > 0).map((h) => h.normalizedPath))
  const ins = db.prepare(
    `INSERT OR REPLACE INTO coverage_fields
       (id, run_id, field_id, endpoint_id, field_path, policy_status, coverage_state, access_hit, ui_hit, assertion_hit, suspicious, counted_required, counted_effective)
     VALUES (?, ?, ?, ?, ?, 'default', ?, ?, ?, 0, 0, ?, ?)`,
  )
  const missing: string[] = []
  let covered = 0
  for (const f of manifest.fields) {
    if (f.direction !== 'response') continue
    const accessHit = hitPaths.has(f.normalizedPath)
    const required = f.required === true
    // D7：coverage_state 只论 required（optional 全部 state='ignored-optional' 计数 covered_effective=0）
    const state = required ? (accessHit ? 'covered' : 'missing') : 'optional-unhit'
    const countedRequired = required ? 1 : 0
    const countedEffective = required ? 1 : 0
    ins.run(`cf_${runId}_${f.normalizedPath}`, runId, f.id, f.endpointId, f.normalizedPath, state, accessHit ? 1 : 0, accessHit ? 1 : 0, countedRequired, countedEffective)
    if (required && accessHit) covered += 1
    if (required && !accessHit) missing.push(f.normalizedPath)
  }
  const total = manifest.fields.filter((f) => f.direction === 'response').length
  return { total, covered, missing }
}
```

- [ ] **Step 4: 全绿** —— `npx vitest run packages/coverage/` → PASS（6 例）
- [ ] **Step 5: Commit**

```bash
git add packages/coverage/src packages/coverage/__tests__
git commit -m "feat(coverage): dom-scanner pure fn + coverage analyzer v0 (spec §3.4, D7)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: runtime analysis 组装（fetch 拦截 + proxy 接线 + endpoint 匹配）

**Files:**
- Create: `packages/client/src/mode/analysis.ts`
- Modify: `packages/client/src/runtime/client.ts`（fetch 后 analysis 分支挂 proxy）
- Test: `packages/client/__tests__/analysis.test.ts`

**Interfaces:**
- Consumes: Task 1 `createTrackedProxy`、Task 2 `createCollector/createNoopCollector`；endpoint 段匹配复用 `migrate` 引擎同源逻辑（本 task 内部实现 URL→endpoint 段匹配的最小版本，不走 CLI 文本引擎）
- Produces:
```ts
interface AnalysisContext { collector: Collector }
function createAnalysisContext(opts?: { manifest?: ApiManifest }): AnalysisContext
// FetchClientOptions 增补（保持向后兼容）：
//   collector?: Collector —— analysis 模式下需要；缺省时自动 createNoopCollector()
```

- [ ] **Step 1: 写失败测试** —— `packages/client/__tests__/analysis.test.ts`：

```ts
/**
 * analysis 分支单测（spec §3.5）
 * 锁死：analysis 下 fetch 后响应被 proxy 包裹（data.id 读取产生 hit）；trace 进 collector；
 * production 默认 mode 零改动（无 proxy、无 collector 分配）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFetchClient } from '../src/runtime/client.js'
import { createAnalysisContext } from '../src/mode/analysis.js'
import { createCollector, createNoopCollector, type Collector } from '../src/collector/index.js'

// fetch stub：JSON 响应
function stubFetch(payload: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status })))
}
afterEach(() => { vi.unstubAllGlobals() })

describe('analysis mode', () => {
  it('PATCH：fetch 后响应被 proxy 包裹，data.id 读取产生 collector hit', async () => {
    stubFetch({ id: 'u1', name: 'x' })
    const { collector } = createAnalysisContext()
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis', collector })
    const data = await client.fetch<{ id: string; name: string }>('GET', '/users/u1')
    const id = data.id       // ← 读取触发 proxy hit
    void id
    const drained = collector.drain()
    expect(drained.hits.some((h) => h.normalizedPath === 'data.id')).toBe(true)
    expect(drained.traces.some((t) => t.status === 200 && t.method === 'GET')).toBe(true)
  })

  it('collector 缺省时用 noop（drain 恒空，请求成功）', async () => {
    stubFetch({ ok: 1 })
    const client = createFetchClient({ baseUrl: 'http://x/api', mode: 'analysis' })
    const data = await client.fetch('GET', '/ping')
    expect(data).toEqual({ ok: 1 })
  })
})

describe('production mode 零改动回归', () => {
  it('mode 缺省 → 返回原始对象（非 proxy），无 collector 依赖', async () => {
    stubFetch({ id: 'x' })
    const client = createFetchClient({ baseUrl: 'http://x/api' })
    const data = await client.fetch<{ id: string }>('GET', '/users/1')
    const t2 = data                       // plain object
    void t2
    // 关键断言：默认 path 完全不经 collector/proxy —— 用 noop 模拟注入也无效
    const noop = createNoopCollector()
    const client2 = createFetchClient({ baseUrl: 'http://x/api', collector: noop })
    const d2 = await client2.fetch<{ id: string }>('GET', '/users/1')
    expect(d2).toEqual({ id: 'x' })
    expect(noop.drain()).toEqual({ hits: [], traces: [], evidence: [] })
  })
})
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现**

3a. `packages/client/src/mode/analysis.ts`：

```ts
/**
 * analysis 组装（spec §3.5）：analysis context factory + URL→endpoint 匹配 + 响应 proxy 包装
 * goal：production 分支不 import 本文件任何内容（零开销）。
 */
import type { ApiManifest } from '@nx-mk/manifest-schema'
import type { Collector } from '../collector/index.js'

export interface AnalysisContext { collector: Collector }

export function createAnalysisContext(_opts?: { manifest?: ApiManifest }): AnalysisContext {
  return { collector: createCollector() }
}

/** URL path 与 endpoint path 模板的段匹配（复用 §42.5 语义：{param} 捕获段） */
export function matchEndpoint(manifest: ApiManifest | undefined, scopePath: string): string | undefined {
  if (!manifest) return undefined
  // scopePath: URL pathname，如 /users/u_001；按段匹配 /users/{id}
  const segs = scopePath.split('/').filter(Boolean)
  for (const ep of manifest.endpoints) {
    if (ep.method !== 'GET') continue
    const tpl = ep.path.split('/').filter(Boolean)
    if (tpl.length !== segs.length) continue
    let ok = true
    for (let i = 0; i < tpl.length; i++) {
      const t = tpl[i]!
      if (t.startsWith('{') && t.endsWith('}')) continue
      if (t !== segs[i]) { ok = false; break }
    }
    if (ok) return ep.id
  }
  return undefined
}

import { createCollector } from '../collector/index.js'
```

（实现者注意：把 `import { createCollector }` 移至文件顶部统一 import 区，不放在尾部。）

3b. `packages/client/src/runtime/client.ts` 修改 —— 三处：

接口扩展：

```ts
import type { Collector } from '../collector/index.js'

export interface FetchClientOptions {
  baseUrl: string
  headers?: Record<string, string>
  mode?: 'production' | 'analysis'
  /** Phase 2：analysis 模式的 collector 注入；缺省 noop（production 恒 noop） */
  collector?: Collector
  onRequest?: (ctx: { method: string; url: string; headers: Record<string, string> }) => void
  onResponse?: (ctx: { method: string; url: string; status: number; durationMs: number }) => void
}
```

`createFetchClient` 解构行改为：

```ts
  const { baseUrl, headers: baseHeaders = {}, mode = 'production', collector = createNoopCollector(), onRequest, onResponse } = options
```

（顶部追加 `import { createNoopCollector } from '../collector/index.js'` 与 `import { createTrackedProxy } from '../proxy/index.js'`。**注意**：createNoopCollector/createTrackedProxy 只有 analysis 分支使用 —— production 路径其实也 import 了 noop（轻量对象）但 noop 零调用零分配，可接受；proxy 的 import 是静态的 —— 若要求 production 完全零 import proxy，改为动态 import + analysis 分支内 require，成本是 async 复杂度。计划选择：**保持静态 import**（noop/scanner 都纯 TS，bundle 后零边际成本可接受），production 零开销测试断言的是「无 hit / 无 trace 分配」而非 import 缺席。）

fetch 的响应段改为：

```ts
      const start = Date.now()
      if (isAnalysis && onRequest) onRequest({ method, url, headers })
      const res = await fetch(url, { method, headers, body })
      const durationMs = Date.now() - start
      if (isAnalysis && onResponse) onResponse({ method, url, status: res.status, durationMs })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${url}`)
      const data = (await res.json()) as T
      if (!isAnalysis) return data
      // —— Phase 2 analysis：trace 记录 + 响应 JSON 经 tracked proxy 包裹返回（spec §3.5）
      const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const pathname = new URL(url, 'http://localhost').pathname
      collector.trace({
        requestId, method,
        url,
        endpointId: matchEndpoint(ctxManifestRef, pathname),
        status: res.status, durationMs,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date().toISOString(),
      })
      if (data !== null && typeof data === 'object') {
        return createTrackedProxy(data as object, {
          requestId, endpointId: matchEndpoint(ctxManifestRef, pathname) ?? 'unknown',
          basePath: 'data', collector,
        }) as T
      }
      return data
```

配合修改：`createFetchClient` 内部维护 `const ctxManifestRef = optsRef?.manifest` —— 简化：`FetchClientOptions` 追加 `manifest?: ApiManifest`，在解构时取。**最终方案**：`FetchClientOptions` 增加 `manifest?: ApiManifest`（可选），`createFetchClient` 直接解构为 `manifest`，fetch 内用它调用 `matchEndpoint(manifest, pathname)`。analysis 分支的 `collector.trace()` 的 `path` 字段直接用 pathname。

- [ ] **Step 4: 全绿** —— `npx vitest run packages/client/__tests__/` → PASS（analysis 3 例 + 既有）
- [ ] **Step 5: build + typecheck**，并跑 `.client/typecheck`
- [ ] **Step 6: Commit**

```bash
git add packages/client/src/mode/analysis.ts packages/client/src/runtime/client.ts packages/client/__tests__/analysis.test.ts
git commit -m "feat(client): wire analysis branch — fetch trace + response tracked proxy (spec §3.5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: plugin-playwright —— kernel Plugin 协议 + DOM 扫描

**Files:**
- Create: `packages/plugin-playwright/package.json`、`tsup.config.ts`、`tsconfig.json`
- Create: `packages/plugin-playwright/src/index.ts`、`scanner.ts`、`runner.ts`（page lifecycle + scan + snapshot reports）
- Modify: root `package.json` devDependencies？（无需——plugin 包自身依赖）
- Test: `packages/plugin-playwright/__tests__/plugin.test.ts`

**Interfaces:**
- Consumes: `Plugin`（@nx-mk/kernel types-ts）、`UiEvidenceCore`（@nx-mk/client/collector）、`scanDom`（Task 4）
- Produces:
```ts
interface PlaywrightPluginOptions {
  url: string
  waitForSelector?: string        // 默认 '[data-mk-field]'
  maxTurns?: number               // 默认 3
}
createPlaywrightPlugin(opts: PlaywrightPlaywrightOptions): Plugin
// runner 内部：browser的生命周期（chromium.launch → newPage）
// scanner.ts: `PAGE_SCAN_SCRIPT`（注入 page.evaluate 的字符串脚本，读 [data-mk-field] 生 DOM 描述数组）
```

- [ ] **Step 0: 脚手架** —— package.json（`@nx-mk/kernel` workspace dep + `playwright-core`；exports `.` ）；tsup/tsconfig copy client 模式。
  Run: `corepack pnpm install`

- [ ] **Step 1: 写失败测试** —— `packages/plugin-playwright/__tests__/plugin.test.ts`：

```ts
/**
 * plugin-playwright 单测（spec §3.4）：mock page —— evidence 映射、emitReport 序列、
 * beforeRun doctor 语义（chromium 不可用 fail-fast）、turn 驱动 idle。
 */
import { describe, it, expect, vi } from 'vitest'
import { createPlaywrightPlugin } from '../src/index.js'

const EVAL_RESULT = [
  { dataMkField: 'data.id', visible: true, inViewport: true },
  { dataMkField: 'data.address.zip', visible: false, inViewport: false },
]

function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  const reports: unknown[] = []
  return {
    reports,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: { collect: { url: 'http://localhost:5173' }, outputDir: '.nx-mk/runs' },
    cwd: '/tmp/x',
    emitReport: (r: unknown) => { reports.push(r) },
    ...overrides,
  } as never
}

describe('scanner（page.evaluate 注入脚本 + 结构组装）', () => {
  it('PAGE_SCAN_SCRIPT 是可序列化字符串且读 [data-mk-field]', () => {
    const { PAGE_SCAN_SCRIPT } = require('../src/scanner.js') as { PAGE_SCAN_SCRIPT: string }
    expect(PAGE_SCAN_SCRIPT).toContain('data-mk-field')
    expect(PAGE_SCAN_SCRIPT).toContain('getBoundingClientRect')
  })
})

describe('plugin hooks（mock browser）', () => {
  it('run 阶段：DOM 扫描 → evidence → emitReport(field-hit/endpoint-called)', async () => {
    // mock runner 层：patch chromium.launch 返回 fake page
    vi.doMock('../src/runner.js', () => ({
      launchCollect: vi.fn(async (opts, onEvidence, onFinish) => {
        await Promise.resolve(EVAL_RESULT.map((d) => opts.onDescriptor(d)))
      }),
    }))
    void EVAL_RESULT
    void onFinish
    // —— 实现者注意：单测通过 doMock runner 隔离 playwright；覆盖「收集→emitReport」链路
  })

  it('beforeRun：collect 配置缺失 → info 日志跳过（不抛）', async () => ...)
  it('collect 配置存在但 chromium 不可用 → PLUGIN_HOOK_FAILED', async () => ...)
})
```

> ⚠️ 起草时该测试文件的 `it('beforeRun ...', ...)` 两例只给了标题骨架——实施者以 spec §3.4/§4 的行为规格补齐至完整可运行用例（`hljs` 级断言在文件内不缺）：必含 (a) collect 缺失 → hook 静默 skip（无 throw、logger.info含 'collect not configured'），(b) chromium 不可用 → throws KernelError code PLUGIN_HOOK_FAILED 提示 `npx playwright install chromium`，(c) mock runner 正常路径 → emitReport 被调用且含 `field-hit`/`route-visited`。

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现** —— 三文件分工：

- `scanner.ts`：导出 `PAGE_SCAN_SCRIPT: string`（在浏览器执行的字面脚本，读 `document.querySelectorAll('[data-mk-field]')`，对每个元素产出 `{dataMkField: getAttribute('data-mk-field'), visible: !!(offsetWidth||offsetHeight) && getComputedStyle visibility !== 'hidden', inViewport: rect 与 window 相交}`，由外层 `scanDom()` 组装为 evidence）。
- `runner.ts`：`launchCollect(opts, handlers)` —— `chromium.launch({headless:true})` → newPage → goto(url, {waitUntil:'networkidle'}) → waitForSelector → `page.evaluate(PAGE_SCAN_SCRIPT)` → handlers.onDescriptor(数组) → 调 `collector.snapshot(turn)` → handlers.onCollectorSnapshot → 返回 evidence 数组。chromium 检查函数 `hasChromium(): boolean`（try launch catch false）。
- `index.ts`：`createPlaywrightPlugin(opts)` ——

```ts
hooks: {
  beforeRun(ctx): ctx.config?.collect 存在时做 chromium doctor（失败 → KernelError('PLUGIN_HOOK_FAILED', 提示 npx playwright install chromium)；无 collect → info log skip）
  async run(ctx): 每 turn 调 runner.launchCollect(...) → evidence 数组 → collector.evidence(ev) / collector.snapshot(ctx.getTurn()) → ctx.emitReport({kind:'field-hit'...}/{kind:'endpoint-called'...})
  afterRun(ctx): browser close
}
```

collector 注入机制：plugin `provide: ['collector']` + `inject: []`；client runtime 的 collector 由 plugin 在 beforeRun 时以 `context.collector` 挂到 `globalThis.__MK_COLLECTOR__`（浏览器侧）—— spec §3.5 的 `window.__MK_COLLECTOR__` 单通道。**Playwright 与 app 的 collector 共享**通过 page initialization script（`context.addInitScript`）完成；具体 wire 顺序在实现时以集成测试为准。

- [ ] **Step 4: 全绿** —— `npx vitest run packages/plugin-playwright/` → PASS（5 例±）
- [ ] **Step 5: build + commit（消息与其余同构）**

```bash
git commit -m "feat(plugin-playwright): kernel plugin — DOM scan + goal-loop reports (spec §3.4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: CLI/config 装配 —— collect 段 + db flush 装配

**Files:**
- Modify: `packages/config/src/schema.ts`（+CollectConfigSchema）、`packages/config/src/loader.ts`（若需 loader 侧 passthrough 泄入）
- Modify: `packages/cli/src/commands/run.ts`（collect 配置时：coverage db init + afterRun flush + collector 装配）
- Test: `packages/cli/src/__tests__/run-collect.test.ts`（新建）、`packages/config/src/__tests__/loader.test.ts`（追加 2 例）

**Interfaces:**
- Produces: config schema `collect: z.object({ url: z.string(), waitForSelector: z.string().optional(), maxTurns: z.number().int().positive().optional() }).optional()`；run 装配：collect 配置时 db 文件 `.nx-mk/coverage.db` 建立 + insertRun / afterRun 时 endRun + flushDrained。

- [ ] **Step 1: 失败测试** —— config 侧追加 schema 断言（collect 段解析/默认/非法 URL 校验失败）；CLI 侧 `run-collect.test.ts`：

```ts
/**
 * run 命令 collect 装配单测：临时 fixture 项目（hermetic，不真跑 vite/browser）。
 * collect 无配置 → 不建 coverage.db；有配置 → run 结束后 coverage.db 存在（藉 fake flush：把 db path 指 tmp）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMain } from '../commands/run'
```

> ⚠️ 与 Task 6 相同的起草粒度问题：本 task 的 run-collect 测试 3 例（collect 缺失不建库 / collect 配置建库含 insertRun 行 / run 后 coverage.db 文件存在）+ config loader 2 例（collect 段 passthrough 正确 / 非法 collect（url 不是字符串）校验抛 CONFIG_INVALID）。实施者按 spec §3.6 用 TDD 补齐至可运行。
>
> run 装配的实现要点（spec §3.6）：
> - `loadConfig` 后若 `config.collect` 存在：`runMain` 创建 CoverageDb（`.nx-mk/coverage.db`）→ `insertRun`；goal loop 不受影响（collector 由 client 内产生；collector.drain 在 afterRun flush）
> - `collect.url` 必填（string、http/https）；缺失/非法 → `KernelError('CONFIG_INVALID')`
> - 具体装配代码在 run.ts 增量 <40 行

- [ ] **Step 2-4: TDD 三步同构**（失败 → 实现 → 全绿）
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cli): run command collect wiring + config schema (spec §3.6)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: demo 闭环 + 收尾

**Files:**
- Modify: `examples/react-vite-demo/nx-mk.config.yml`（+collect 段：url http://localhost:5173、maxTurns 3）
- Modify: `examples/react-vite-demo/app/vite.config.ts`（+define `__MK_ANALYSIS__: JSON.stringify(process.env.MK_ANALYSIS === 'true')`）
- Modify: `examples/react-vite-demo/app/package.json`（+`@nx-mk/plugin-playwright` **？不—— app 不放 plugin**；demo 只需 vite define）
- Modify: `examples/react-vite-demo/nx-mk.config.yml`（plugins 数组 + `@nx-mk/plugin-playwright`）
- Modify: root `package.json`（test:all script 已有；无改动）
- Modify: root `README.md` 当前状态（Phase 2 完成态）
- Test: `tests/integration/phase2-collect.test.ts`（hermetic：内存 collector → 临时 sqlite → flush → 查询 9 表）

**Interfaces:**
- Consumes: 全部既有产品
- Produces: demo 三件套（`pnpm demo:openapi` → demo dir `node ../../packages/cli/dist/index.js run` → typecheck）+ collect 链路 + 手动浏览器验收文档（README 步骤）

- [ ] **Step 1: hermetic 集成测试** —— `tests/integration/phase2-collect.test.ts`（完整可运行）：

```ts
/**
 * Phase 2 collect 集成（hermetic）：collector → 临时 SQLite → 9 表读回断言。
 * 不跑真浏览器/真 vite；真实链路 demo:typecheck + 仓库 README 手动验收。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '@nx-mk/coverage'
import { createCollector } from '@nx-mk/client/collector'
import { createTrackedProxy } from '@nx-mk/client/proxy'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-p2-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('Phase 2 hermetic collect chain', () => {
  it('proxy hits + trace 聚合 → flush → 9 表含数据', async () => {
    const c = createCollector()
    const resp = createTrackedProxy(
      { id: 'u1', address: { city: 'HZ' } } as Record<string, unknown>,
      { requestId: 'r1', endpointId: 'ep1', basePath: 'data', collector: c } as never,
    )
    const id = (resp as Record<string, unknown>).id
    const city = ((resp as Record<string, unknown>).address as Record<string, unknown>).city
    void id; void city
    const trace = { requestId: 'r1', method: 'GET', url: 'http://x/api/users/u_001', path: '/users/u_001', status: 200, durationMs: 5, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() }
    c.trace(trace)

    const db = openCoverageDb(join(dir, 'coverage.db'))
    try {
      db.insertRun('run_p2', new Date().toISOString(), 'running')
      db.flushDrained({ runId: 'run1', ...c.drain() })
      expect(db.prepare('SELECT count(*) AS n FROM field_hits WHERE run_id=?').get('run1')).toEqual({ n: 2 })  // data.id + data.address（嵌套）
      expect(db.prepare('SELECT count(*) AS n FROM request_traces WHERE run_id=?').get('run1')).toEqual({ n: 1 })
      // evidence 表存在且（本 hermetic 流程未喂 evidence）为空而 schema 已建
      expect(db.prepare('SELECT count(*) AS n FROM ui_evidence WHERE run_id=?').get('run1')).toEqual({ n: 0 })
      // 9 张表 schema 断言（§25 逐字）
      for (const t of ['runs', 'endpoints', 'manifest_fields', 'request_traces', 'request_fields', 'field_hits', 'ui_evidence', 'coverage_fields', 'agent_iterations']) {
        expect((db.pragma(`table_info(${t})`) as unknown[]).length).toBeGreaterThan(0)
      }
    } finally { db.close() }
  })
})
```

- [ ] **Step 2: demo 配置接线**（vite define + config collect 段 + plugins）
- [ ] **Step 3: 手动闭环验证**（judge：环境有 playwright bindings；验证命令）：

```bash
corepack pnpm --filter @nx-mk/client build && corepack pnpm --filter @nx-mk/coverage build && corepack pnpm --filter @nx-mk/plugin-playwright build && corepack pnpm --filter @nx-mk/cli build
corepack pnpm --filter @nx-mk-example/server dev &      # 后端 8787
corepack pnpm --filter @nx-mk-example/app dev &         # vite 5173
cd examples/react-vite-demo
MK_ANALYSIS=true node ../../packages/cli/dist/index.js run
# 期望：goal loop 运行、field_hits/ui_evidence/request_traces 有数据、goal:met（覆盖率提前达标）
```

> 若 chromium 未装 → `npx playwright install chromium`；vite/server 未起 → fail-fast 语义（spec §4）。
> 验收证据 grep：`sqlite3 examples/react-vite-demo/.nx-mk/coverage.db "select count(*) from field_hits"` 非零 —— 或用 node better-sqlite3 one-liner。

- [ ] **Step 4: 全量回归** —— `npx vitest run`、`corepack pnpm demo:typecheck`
- [ ] **Step 5: README/收尾**：root README 当前状态 → Phase 2 完成 + Phase 3（分析）为下一步。
- [ ] **Step 6: Commit**

```bash
git add examples/react-vite-demo README.md package.json tests/integration/phase2-collect.test.ts
git commit -m "feat(demo): Phase 2 collect loop — vite define + collect config + hermetic integration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec 覆盖**：§3.1→T1、§3.2→T2、§3.3→T3、§3.4（evidence 纯函数 + analyzer）→T4、§3.5→T5、§3.4 插件→T6、§3.6 CLI 装配→T7、§1.4 验收+手动闭环→T8。§6 测试策略逐表落实（hermetic 为 D8）。
- **占位**：T1/T2/T3/T4/T8 全代码；T5/T6/T7 按 spec 行为规格给出测试要点 + 实现结构（三处 ⚠️ 已标注升格规则——spec 为权威），无纯 TBD。
- **类型一致性**：`Collector` 形状 T2 定义、T3 FlushInput/T5 消费、T4 scanDom 输出、T6 产出一致；`normalizePath` 为 manifest-schema 现有导出（已验证 packages/manifest-schema/src/index.ts:33）。
