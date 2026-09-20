# Phase 4.5 Dashboard 可操作化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard 新增四能力——Replay Request（服务端安全三分类 + `.nx-mk/replays/` 留痕）、plugin settings 只读装配 + YAML 片段生成、SSE 事件桥（events.jsonl 文件 tail）、manifest 树 + schema 表浏览页。

**Architecture:** kernel 在 initPlugins 后一次性写 `.nx-mk/plugins-manifest.json`（R7）；CLI run 在 manifest 读取成功后快照到 `.nx-mk/runs/<runId>/manifest.json`（本计划 V2 裁定——spec 假定该文件存在但无写入方）；dashboard server 新增 replay/event-tail 两模块 + 5 条路由；UI 新增 useEventSource（轮询保留，R11）+ 2 个新页面 + RequestDetail Replay 行。

**Tech Stack:** Node v22 (PATH prefix required); `corepack pnpm`; vitest; fastify 5（reply.hijack SSE）; better-sqlite3; react 19 (renderToString node-env tests); tsup; tsc --noEmit

**Spec:** `docs/superpowers/specs/2026-09-20-nx-mk-phase45-dashboard-ops-design.md`（U1-U6 裁定 / R1-R11 设计裁定 / E1-E8 错误表 / §5 验收）

## 现实核查裁定（spec 前提 vs 代码事实 —— 实施者按此执行，勿"纠正"）

写计划前对 spec 逐条核实了代码，三处 spec 事实前提不成立，裁定如下（SDD 执行时进台账）：

- **V1（request:captured 无内核源）**：KernelEvent 全集 = phase:start/end、plugin:loaded/error/state-change、kernel:error、turn:start/end、goal:met/unmet（`packages/kernel/src/event-bus.ts:12-23`）。请求采集走 collector→report→analyzer 管道，**不经过事件总线**，events.jsonl 无请求级记录。U4 的"内核已发 request:captured"对该一类不成立。**裁定**：SSE 桥 v0 输出三类——`stage:start`←phase:start、`stage:done`←phase:end、`agent:iteration`←turn:end；request:captured 推 Phase 6（RunState 聚合）。UI 请求列表的近实时性由 R11 的"SSE 事件触发立即 refresh"保住（turn:end 到来即刷新）。
- **V2（per-run manifest.json 无写入方）**：全仓无人写 `.nx-mk/runs/<runId>/manifest.json`；`.nx-mk/manifest.json` 是项目级用户输入。**裁定**：CLI run.ts 本来就在 `run.ts:132` readFileSync 该文件做形状门控——门控通过后顺手快照进 run 目录（~5 行）。无效/缺失 manifest 不落快照 → 旧 run 与失败 run 由 manifest 路由诚实 404（E8 语义成立）。
- **V3（replay 无原始 body 可复刻）**：request_traces 列不含 headers/reqBody（coverage.db 有意不存原始 body）。**裁定**：replay 只复刻 method+url；PUT 复刻时由 server 生成 `idempotency-key: replay-<runId>-<requestId>-<ts>` 头（故 PUT 归 idempotent，贴合 §27.2 原意）；留痕中的 reqBody 恒为 `''`（截断规则平凡满足）。
- **V4（idempotent 的确认门）**：spec E2 只定义 unsafe 无 confirm→409。**裁定**：idempotent 与 unsafe 同样要求 confirm（都是非 GET 写操作，确认门廉价）；verdict 仍区分记录（徽章/留痕显示 idempotent vs unsafe），行为一致。
- **V5（config 字段语义）**：v0 `config.plugins` 是 `string[]`，无 per-plugin 配置命名空间；`validateConfigSchema` 拿**全量 ResolvedConfig** 校验（plugin-registry.ts:126-136）。**裁定**：plugins-manifest.json 的 per-plugin `config` = 全量 ResolvedConfig 的 JSON 快照（即"该插件可见的配置"的真实现状语义）；`enabled` 恒 true（形状为 v1 预留）。

## Global Constraints

- Windows + Git Bash；**所有** node/vitest/tsc/pnpm 命令前缀 `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH`
- `corepack pnpm`；测试从仓库根 `npx vitest run`（本包调试可 `npx vitest run packages/dashboard`）
- **零新 npm 依赖**（D2 五件套不动）；SSE 用 fastify 原生 reply.hijack；manifest 响应用 shared/api-types.ts 结构类型，**不新增** @nx-mk/manifest-schema 依赖
- 文件 ≤400 行；中文注释 + 英文 CLI/测试；ESM `.js` 后缀 import；verbatimModuleSyntax；noUncheckedIndexedAccess
- 不写 attribution 行（用户覆盖规则）
- UI 测试环境是 **node + renderToString**（无 jsdom、无 user events）——交互流程由路由测试覆盖，UI 测试只断言渲染输出
- 只读铁律（R2 收缩后）：dashboard server 对三来源零写路径，**唯一例外** replay.ts 的 `.nx-mk/replays/` 留痕写；Task 8 有 grep 核查
- 每任务结束跑全测试套绿屏（当前基线 502/502）才进下一任务
- 涉及 dashboard 包的任务改完跑 `corepack pnpm -F @nx-mk/dashboard build` 确认 tsup/vite 双构建不破

---

## Task 1: kernel — plugins-manifest.json 落盘（R7）

**Files:**
- Create: `packages/kernel/src/plugins-manifest.ts`
- Modify: `packages/kernel/src/kernel-runtime.ts`（initPlugins 分支末尾追加 3 行）
- Test: `packages/kernel/src/__tests__/plugins-manifest.test.ts`（新建）

**Interfaces:**
- Consumes: `Plugin`（`packages/kernel/src/plugin.ts`：name/version/configSchema?）、`ResolvedConfig`（kernel types）
- Produces: `buildPluginsManifest(plugins: Plugin[], config: ResolvedConfig | undefined): PluginsManifestFile`、`writePluginsManifest(cwd: string, manifest: PluginsManifestFile): void`（同目录内部函数，不入 index.ts 公共导出）。文件形状 `{generatedAt: string, plugins: [{name, version, enabled: true, config: unknown, configSchema: object|null}]}` —— Task 5 的 plugins-reader 按此门控。

- [ ] **Step 1: 写失败测试（纯函数部分）**

新建 `packages/kernel/src/__tests__/plugins-manifest.test.ts`：

```ts
/**
 * plugins-manifest.json 落盘单测（Phase 4.5 R7）：
 * 形状 / configSchema 序列化降级（E5）/ config 全量快照语义（V5）/ IO 失败静默。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from '../plugin.js'
import { buildPluginsManifest, writePluginsManifest } from '../plugins-manifest.js'

const fakeSchemaWithJson = {
  '~standard': { validate: () => {} },
  jsonSchema: { type: 'object', properties: { url: { type: 'string' } } },
} as unknown as Plugin['configSchema']

const schemaWithoutJson = { '~standard': { validate: () => {} } } as unknown as Plugin['configSchema']

describe('buildPluginsManifest', () => {
  it('serializes name/version/enabled/config/configSchema', () => {
    const p: Plugin = { name: '@nx-mk/plugin-swagger', version: '0.1.0', hooks: {}, configSchema: fakeSchemaWithJson }
    const m = buildPluginsManifest([p], { logLevel: 'info' } as never)
    expect(m.plugins).toHaveLength(1)
    const e = m.plugins[0]!
    expect(e.name).toBe('@nx-mk/plugin-swagger')
    expect(e.version).toBe('0.1.0')
    expect(e.enabled).toBe(true)
    expect(e.config).toEqual({ logLevel: 'info' })
    expect(e.configSchema).toEqual({ type: 'object', properties: { url: { type: 'string' } } })
    expect(typeof m.generatedAt).toBe('string')
  })

  it('configSchema without jsonSchema prop → null (E5/R8)', () => {
    const p: Plugin = { name: 'bare', version: '1.0.0', hooks: {}, configSchema: schemaWithoutJson }
    expect(buildPluginsManifest([p], undefined).plugins[0]!.configSchema).toBeNull()
  })

  it('plugin without configSchema → null; undefined config → null', () => {
    const m = buildPluginsManifest([{ name: 'x', version: '1', hooks: {} }], undefined)
    expect(m.plugins[0]!.configSchema).toBeNull()
    expect(m.plugins[0]!.config).toBeNull()
  })
})

describe('writePluginsManifest', () => {
  it('writes .nx-mk/plugins-manifest.json under cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nx-mk-pm-'))
    try {
      writePluginsManifest(dir, buildPluginsManifest([], undefined))
      const parsed: unknown = JSON.parse(readFileSync(join(dir, '.nx-mk', 'plugins-manifest.json'), 'utf8'))
      expect((parsed as { plugins: unknown[] }).plugins).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('IO failure is silent (E4 downstream handles missing file)', () => {
    // cwd 指向一个文件 → mkdir/write 必失败 → 不抛
    const dir = mkdtempSync(join(tmpdir(), 'nx-mk-pm-'))
    const blocker = join(dir, 'file')
    writeFileSync(blocker, 'x')
    expect(() => writePluginsManifest(blocker, buildPluginsManifest([], undefined))).not.toThrow()
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/kernel/src/__tests__/plugins-manifest.test.ts`
Expected: FAIL — `Cannot find module '../plugins-manifest.js'`

- [ ] **Step 3: 实现 `packages/kernel/src/plugins-manifest.ts`**

```ts
/**
 * plugins-manifest.json 落盘（Phase 4.5 spec R7）：initPlugins 完成后一次性写
 * .nx-mk/plugins-manifest.json，供 dashboard 只读消费（GET /api/plugins）。
 * 写失败静默跳过——dashboard 侧按缺失降级（E4），分析产物不缺角。
 *
 * V5 裁定：v0 无 per-plugin 配置命名空间（config.plugins 是 string[]，插件从全量
 * ResolvedConfig 读自己的字段），故 per-plugin config = 全量配置的 JSON 快照。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from './plugin.js'
import type { ResolvedConfig } from './types.js'

/** plugins-manifest.json 单条目形状（dashboard store/plugins-reader.ts 同构门控） */
export interface PluginManifestEntry {
  name: string
  version: string
  /** v0 无停用语义，恒 true；形状为 v1 预留 */
  enabled: boolean
  /** 全量 ResolvedConfig 的 JSON 快照（V5 裁定）；不可序列化 → null */
  config: unknown
  /** standard-schema 适配器挂 jsonSchema 属性则取之；否则 null（spec E5/R8） */
  configSchema: Record<string, unknown> | null
}

export interface PluginsManifestFile {
  generatedAt: string
  plugins: PluginManifestEntry[]
}

/** standard-schema 对象 → JSON Schema：仅当适配器挂了可序列化 jsonSchema 属性（E5：否则 null） */
export function serializeConfigSchema(schema: Plugin['configSchema']): Record<string, unknown> | null {
  if (!schema) return null
  const candidate = (schema as { jsonSchema?: unknown }).jsonSchema
  if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>
  }
  return null
}

export function buildPluginsManifest(plugins: Plugin[], config: ResolvedConfig | undefined): PluginsManifestFile {
  let configOut: unknown = null
  if (config !== undefined) {
    try {
      configOut = JSON.parse(JSON.stringify(config))
    } catch {
      configOut = null // 不可序列化 → null（E5 同族降级）
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    plugins: plugins.map((p) => ({
      name: p.name,
      version: p.version,
      enabled: true,
      config: configOut,
      configSchema: serializeConfigSchema(p.configSchema),
    })),
  }
}

/** initPlugins 完成后调用；任何 IO 失败吞掉（dashboard E4 兜底），不影响 run */
export function writePluginsManifest(cwd: string, manifest: PluginsManifestFile): void {
  try {
    const dir = join(cwd, '.nx-mk')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'plugins-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  } catch {
    // 落盘失败不阻断 run —— dashboard 按缺失降级（E4）
  }
}
```

- [ ] **Step 4: 接线 kernel-runtime.ts**

在 `packages/kernel/src/kernel-runtime.ts` 的 `initPlugins` 分支末尾（`await runHooksForPhaseWithCapture(phase, 'after', ...)` 之后、`runPhase` 进入下一分支前）追加：

```ts
      // Phase 4.5（R7）：initPlugins 完成即快照插件清单供 dashboard 只读消费；
      // 生产装配与测试注入两条路径都在此收口。写失败静默（E4 兜底）。
      writePluginsManifest(cwd, buildPluginsManifest(deps.getPlugins(), deps.getConfig()))
```

文件顶部 import 区加：

```ts
import { buildPluginsManifest, writePluginsManifest } from './plugins-manifest.js'
```

（`cwd` 变量在 runPhase 作用域内已存在——resolvePlugins 分支已在用。）

- [ ] **Step 5: 集成测试（createKernel 全相位跑通后文件存在）**

在同测试文件追加：

```ts
describe('kernel integration: manifest written after run', () => {
  it('writes plugins-manifest.json when a run completes', async () => {
    const { createKernel } = await import('../kernel.js')
    const dir = mkdtempSync(join(tmpdir(), 'nx-mk-pm-run-'))
    const configPath = join(dir, 'nx-mk.config.yml')
    // 最小可运行配置（对齐 kernel.test.ts writeConfig 的形状）
    writeFileSync(configPath, 'plugins: []\nlogLevel: info\n', 'utf8')
    const p: Plugin = { name: '@nx-mk/idle', version: '1.0.0', hooks: {} }
    try {
      const kernel = createKernel({ configPath, runId: 'r_pm' as never, subcommand: 'run', cwd: dir, plugins: [p] })
      await kernel.run()
      const parsed: unknown = JSON.parse(readFileSync(join(dir, '.nx-mk', 'plugins-manifest.json'), 'utf8'))
      const entries = (parsed as { plugins: { name: string }[] }).plugins
      expect(entries.map((e) => e.name)).toContain('@nx-mk/idle')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 6: 全套测试 + 行数核查**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run`
Expected: 全绿（502 基线 + 本任务新增 6）
Run: `wc -l packages/kernel/src/plugins-manifest.ts packages/kernel/src/kernel-runtime.ts`
Expected: 均 ≤400（kernel-runtime.ts 现 352 + ~4 行仍 ≤400）

- [ ] **Step 7: Commit**

```bash
git add packages/kernel/src/plugins-manifest.ts packages/kernel/src/kernel-runtime.ts packages/kernel/src/__tests__/plugins-manifest.test.ts
git commit -m "feat(kernel): plugins-manifest.json 落盘 —— initPlugins 后快照插件清单（R7）"
```

---

## Task 2: CLI — per-run manifest 快照（V2 裁定）

**Files:**
- Modify: `packages/cli/src/commands/run.ts:132` 附近（isManifestShaped 成功分支）
- Test: `packages/cli/src/__tests__/run-coverage.test.ts`（追加用例）

**Interfaces:**
- Consumes: run.ts 既有的 manifest 读取 + 形状门控块；作用域内 `runId`/`cwd`
- Produces: `.nx-mk/runs/<runId>/manifest.json` 快照文件（内容 = 项目 manifest 原样 JSON）——Task 5 的 GET /api/runs/:runId/manifest 数据源

- [ ] **Step 1: 写失败测试**

在 `packages/cli/src/__tests__/run-coverage.test.ts` 追加（沿该文件既有 harness：tmp workDir、mock plugin-playwright、真 runMain；复用文件内已有的 MANIFEST_1FIELD 写盘与 collector 装配模式——找到既有"analyzer 跑通"用例，克隆其装配代码，仅断言不同）：

```ts
it('snapshots per-run manifest.json into the run dir (Phase 4.5 V2)', async () => {
  // —— 装配与既有「三指标非零」用例完全一致：写 manifest.json + coverage 配置 + collector + runMain ——
  // （从上方最近的 analyzer 成功用例复制 setup 段；此处仅列差异断言）
  silenceConsole()
  // ...<同既有成功用例的 setup：manifest 写盘、configPath 写 coverage 段、collector 注入、runMain>...
  // runId 从产物回读（真实 makeRunId 非确定值）
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { runId: string }
  const snapshotPath = join(workDir, '.nx-mk', 'runs', report.runId, 'manifest.json')
  expect(existsSync(snapshotPath)).toBe(true)
  const snap = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { fields: unknown[] }
  expect(Array.isArray(snap.fields)).toBe(true)
})

it('does not snapshot when manifest is missing (E8 honest 404 for legacy shape)', async () => {
  silenceConsole()
  // ...<同既有「manifest 缺失 → 空报告」用例的 setup：不写 manifest.json>...
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { runId: string }
  expect(existsSync(join(workDir, '.nx-mk', 'runs', report.runId, 'manifest.json'))).toBe(false)
})
```

注意：上面 `<同既有...>` 处必须用该文件中既有用例的**真实 setup 代码**填入（本文件 harness 已能跑通两种场景——成功用例与 manifest 缺失用例都存在），不是留空。

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/cli/src/__tests__/run-coverage.test.ts`
Expected: 新增第 1 用例 FAIL（snapshotPath 不存在）；第 2 用例 PASS（本来就不存在）

- [ ] **Step 3: 实现（run.ts 形状门控成功分支内加快照写）**

`packages/cli/src/commands/run.ts` 中：

```ts
          let manifest: AnalyzeInput['manifest'] | undefined
          try {
            const parsed: unknown = JSON.parse(readFileSync(join(cwd, '.nx-mk', 'manifest.json'), 'utf8'))
            if (isManifestShaped(parsed)) manifest = parsed
          } catch {
```

改为：

```ts
          let manifest: AnalyzeInput['manifest'] | undefined
          try {
            const parsed: unknown = JSON.parse(readFileSync(join(cwd, '.nx-mk', 'manifest.json'), 'utf8'))
            if (isManifestShaped(parsed)) {
              manifest = parsed
              // Phase 4.5（V2 裁定）：per-run manifest 快照 —— manifest 浏览器页数据源。
              // 仅有效 manifest 落快照；缺失/形状非法不落 → 旧 run 由路由诚实 404（spec E8）。
              // 写失败 warn 不阻断（快照是浏览便利产物，不是审计链三角）。
              try {
                writeFileSync(
                  join(cwd, '.nx-mk', 'runs', runId, 'manifest.json'),
                  JSON.stringify(parsed, null, 2),
                  'utf8',
                )
              } catch (err) {
                console.warn(`per-run manifest snapshot write failed: ${(err as Error).message}`)
              }
            }
          } catch {
```

（`writeFileSync` 已在该文件 import；`runId`/`cwd` 作用域内已有。runs/<runId> 目录此时必存在——kernel 已在其中写 events.jsonl/kernel.log。）

- [ ] **Step 4: 跑测试确认通过 + 全套绿屏**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/cli/src/__tests__/run-coverage.test.ts` → PASS
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run` → 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/run.ts packages/cli/src/__tests__/run-coverage.test.ts
git commit -m "feat(cli): per-run manifest 快照 —— manifest 浏览器页数据源（E8 诚实 404）"
```

---

## Task 3: dashboard server — Replay Request（classify + POST + 留痕 + 列表）

**Files:**
- Create: `packages/dashboard/src/server/replay.ts`
- Create: `packages/dashboard/src/server/routes/replay.ts`
- Modify: `packages/dashboard/src/server/index.ts`（注册路由）
- Modify: `packages/dashboard/src/shared/api-types.ts`（追加类型）
- Test: `packages/dashboard/src/__tests__/replay.test.ts`（新建）

**Interfaces:**
- Consumes: `RouteContext`（server/types.ts：`{nxMkDir: string, busyTimeoutMs?: number}`）；`openReader`/`DbBusyError`/`Queries.getTrace(runId, requestId)`/`reportForRun`（既有）；fixtures.ts 的 `makeNxMkDir`/`seedDb`
- Produces: `classifyReplay(method: string, url: string): {verdict: ReplayVerdict, reason: string}`、`ReplayVerdict = 'safe'|'idempotent'|'unsafe'|'blocked'`、路由 `POST /api/runs/:runId/replay/request/:requestId`（body `{confirm?: boolean}`）与 `GET /api/runs/:runId/replays`。api-types 新增 `ReplayResponse`/`ReplaysListResponse`（下方 Step 1 原文）——Task 6 UI 直接消费。

- [ ] **Step 1: api-types 追加（`packages/dashboard/src/shared/api-types.ts` 末尾）**

```ts
// —— Phase 4.5：Replay Request（spec §2.1/R1-R5；plan §27.2 ReplaySafety v0 子集）——

export type ReplayVerdict = 'safe' | 'idempotent' | 'unsafe' | 'blocked'

/** POST /api/runs/:runId/replay/request/:requestId 响应（R4：replay-error 也是 200） */
export interface ReplayResponse {
  /** 留痕文件 ID（= 文件名去 .json）；留痕写失败为 null（结果仍返回） */
  replayId: string | null
  verdict: ReplayVerdict
  reason: string
  ok: boolean
  status: number | 'replay-error' | null
  durationMs: number | null
  /** 响应 body 前 500 字符（R5 截断规则）；replay-error 时 null */
  bodyPreview: string | null
  /** replay-error 时的错误摘要（E3） */
  error?: string
}

/** GET /api/runs/:runId/replays —— 留痕列表（v0 扩展路由，§30.2 未列） */
export interface ReplaySummary {
  replayId: string
  verdict: ReplayVerdict
  ok: boolean
  status: number | 'replay-error' | null
  createdAt: string
}
export interface ReplaysListResponse {
  replays: ReplaySummary[]
}
```

- [ ] **Step 2: 写失败测试（分类纯函数 + 路由）**

新建 `packages/dashboard/src/__tests__/replay.test.ts`：

```ts
/**
 * Replay Request 路由测试（Phase 4.5）：三分类矩阵 / blocked 403 / 无 confirm 409 /
 * fetch mock 复刻参数快照 / replay-error 200（R4）/ 留痕文件形状（R5）/ 留痕列表。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, rmSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { buildServer } from '../server/index.js'
import { makeNxMkDir, reportFixture, writeReportFile, seedDb } from './fixtures.js'
import { classifyReplay } from '../server/replay.js'
import type { FastifyInstance } from 'fastify'
import type { ReplayResponse, ReplaysListResponse } from '../shared/api-types.js'

describe('classifyReplay（plan §27.2 矩阵）', () => {
  it('GET/HEAD → safe', () => {
    expect(classifyReplay('GET', 'http://api.local/users/1').verdict).toBe('safe')
    expect(classifyReplay('HEAD', 'http://api.local/users/1').verdict).toBe('safe')
  })
  it('PUT → idempotent（复刻时生成 Idempotency-Key，V3）', () => {
    expect(classifyReplay('PUT', 'http://api.local/users/1').verdict).toBe('idempotent')
  })
  it('POST/PATCH/DELETE → unsafe', () => {
    expect(classifyReplay('POST', 'http://api.local/orders').verdict).toBe('unsafe')
    expect(classifyReplay('PATCH', 'http://api.local/orders/1').verdict).toBe('unsafe')
    expect(classifyReplay('DELETE', 'http://api.local/orders/1').verdict).toBe('unsafe')
  })
  it('敏感路径 → blocked（压过 method 规则）', () => {
    expect(classifyReplay('GET', 'http://api.local/payment/123').verdict).toBe('blocked')
    expect(classifyReplay('POST', 'http://api.local/x/refund').verdict).toBe('blocked')
  })
})

describe('replay 路由', () => {
  let dir: string
  let app: FastifyInstance

  beforeEach(() => {
    dir = makeNxMkDir([{ runId: 'run_b' }])
    seedDb(dir, {
      runs: [{ id: 'run_b', status: 'completed' }],
      traces: [
        { runId: 'run_b', traceId: 'req_get', method: 'GET', url: 'http://api.local/users/1', path: '/users/1', status: 200, durationMs: 12, startedAt: '2026-09-20T10:00:01.000Z' },
        { runId: 'run_b', traceId: 'req_post', method: 'POST', url: 'http://api.local/orders', path: '/orders', status: 201, durationMs: 30, startedAt: '2026-09-20T10:00:02.000Z' },
        { runId: 'run_b', traceId: 'req_pay', method: 'GET', url: 'http://api.local/payment/9', path: '/payment/9', status: 200, durationMs: 5, startedAt: '2026-09-20T10:00:03.000Z' },
        { runId: 'run_b', traceId: 'req_put', method: 'PUT', url: 'http://api.local/users/1', path: '/users/1', status: 200, durationMs: 8, startedAt: '2026-09-20T10:00:04.000Z' },
      ],
      hits: [],
      evidence: [],
      coverageFields: [],
    })
    writeReportFile(dir, reportFixture('run_b'))
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
  })
  afterEach(async () => {
    await app.close()
    vi.unstubAllGlobals()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('blocked → 403（E1）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_pay' })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { verdict: string }).verdict).toBe('blocked')
  })

  it('unsafe 无 confirm → 409（E2）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_post' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: string }).error).toBe('unsafe method requires confirmation')
  })

  it('idempotent 无 confirm → 409（V4：与 unsafe 同门）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_put' })
    expect(res.statusCode).toBe(409)
  })

  it('safe GET 直接复刻：fetch 以原 method+url 调用，200 响应（V3：无 body/无多余头）', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":1}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_get' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReplayResponse
    expect(body.verdict).toBe('safe')
    expect(body.ok).toBe(true)
    expect(body.status).toBe(200)
    expect(body.bodyPreview).toBe('{"id":1}')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('http://api.local/users/1')
    expect(calledOpts.method).toBe('GET')
  })

  it('PUT confirm 后复刻带生成的 idempotency-key（V3）', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_put', payload: { confirm: true } })
    expect(res.statusCode).toBe(200)
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['idempotency-key']).toMatch(/^replay-run_b-req_put-\d+$/)
  })

  it('网络层失败 → 200 {status:"replay-error"}（R4/E3）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_get' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReplayResponse
    expect(body.status).toBe('replay-error')
    expect(body.ok).toBe(false)
    expect(body.error).toContain('ECONNREFUSED')
  })

  it('留痕文件写入 .nx-mk/replays/<runId>/ 且形状合规（R5）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"a":1}', { status: 200 })))
    await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_get' })
    const replayDir = join(dir, 'replays', 'run_b')
    const files = readdirSync(replayDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^req_get-\d+\.json$/)
    const trail = JSON.parse(readFileSync(join(replayDir, files[0]!), 'utf8')) as Record<string, unknown>
    expect(trail.verdict).toBe('safe')
    expect((trail.request as Record<string, unknown>).method).toBe('GET')
    expect((trail.request as Record<string, unknown>).url).toBe('http://api.local/users/1')
    expect((trail.request as Record<string, unknown>).reqBody).toBe('')
    expect(((trail.response as Record<string, unknown>).bodyPreview as string).length).toBeLessThanOrEqual(500)
  })

  it('GET /api/runs/:runId/replays 返回留痕列表（新→旧）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })))
    await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_get' })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/replays' })
    expect(res.statusCode).toBe(200)
    const list = res.json() as ReplaysListResponse
    expect(list.replays).toHaveLength(1)
    expect(list.replays[0]!.replayId).toMatch(/^req_get-\d+$/)
  })

  it('留痕列表：无留痕 → 空数组；未知 run → 404', async () => {
    const empty = await app.inject({ method: 'GET', url: '/api/runs/run_b/replays' })
    expect((empty.json() as ReplaysListResponse).replays).toEqual([])
    const missing = await app.inject({ method: 'GET', url: '/api/runs/run_x/replays' })
    expect(missing.statusCode).toBe(404)
  })

  it('未知 request → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/nope' })
    expect(res.statusCode).toBe(404)
  })
})
```

注意 fixtures 的 `seedDb` 若不接受空 `coverageFields` 键或键名不同，以 `fixtures.ts` 的 `DbSeed` 实际形状为准调整（该文件 85 行起有 seedDb 签名）。

- [ ] **Step 3: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/replay.test.ts`
Expected: FAIL — cannot find module '../server/replay.js'；路由 404

- [ ] **Step 4: 实现 `packages/dashboard/src/server/replay.ts`**

```ts
/**
 * Replay Request（Phase 4.5 spec R1-R5）：服务端安全三分类 → fetch 复刻 → .nx-mk/replays/ 留痕。
 * R1 分类在服务端做；R3 不写 coverage.db、不触发重采集；R4 网络失败 → 200 replay-error；
 * R5 留痕含 verdict + 请求快照（reqBody 截断）+ 响应摘要。
 * V3 裁定：复刻只带 method+url（traces 不存原始 body/headers）；PUT 由 server 生成
 * idempotency-key 头，故 PUT 归 idempotent；V4 裁定：idempotent 与 unsafe 同样要 confirm。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReplayVerdict } from '../shared/api-types.js'

/** 敏感路径词表（plan §27.2「payment/delete 等敏感路径 => blocked」的 v0 实现） */
const SENSITIVE_PATH_RE = /payment|refund|payout|withdraw/i
const REPLAY_TIMEOUT_MS = 10_000
const PREVIEW_LIMIT = 500

export interface ReplayClassification {
  verdict: ReplayVerdict
  reason: string
}

/** R1：分类纯函数 —— blocked 压过 method 规则 */
export function classifyReplay(method: string, url: string): ReplayClassification {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    /* 畸形 URL 按原文判别 */
  }
  if (SENSITIVE_PATH_RE.test(path)) {
    return { verdict: 'blocked', reason: `sensitive path matched /${SENSITIVE_PATH_RE.source}/` }
  }
  if (method === 'GET' || method === 'HEAD') return { verdict: 'safe', reason: 'read-only method' }
  if (method === 'PUT') return { verdict: 'idempotent', reason: 'PUT replayed with generated idempotency-key' }
  return { verdict: 'unsafe', reason: `${method} is not idempotent` }
}

export interface ReplayOutcome {
  ok: boolean
  status: number | 'replay-error'
  durationMs: number
  bodyPreview: string | null
  error?: string
}

/** fetch 复刻（10s 超时；PUT 生成幂等键）；网络层失败 → replay-error（R4），不抛 */
export async function performReplay(method: string, url: string, idempotencyKey: string | null): Promise<ReplayOutcome> {
  const startedAt = Date.now()
  const headers: Record<string, string> = idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}
  try {
    const res = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
    })
    const text = await res.text()
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      bodyPreview: text.slice(0, PREVIEW_LIMIT),
    }
  } catch (err) {
    return {
      ok: false,
      status: 'replay-error',
      durationMs: Date.now() - startedAt,
      bodyPreview: null,
      error: (err as Error).message,
    }
  }
}

export interface ReplayTrail {
  replayId: string
  runId: string
  requestId: string
  verdict: ReplayVerdict
  reason: string
  createdAt: string
  request: { method: string; url: string; headers: Record<string, string>; reqBody: string }
  response: { ok: boolean; status: number | 'replay-error'; durationMs: number; bodyPreview: string | null; error?: string }
}

export function makeReplayId(requestId: string): string {
  return `${requestId}-${Date.now()}`
}

/** 留痕写盘（R2 铁律收缩项：dashboard server 唯一写路径）；失败返回 null 不影响响应 */
export function writeReplayTrail(nxMkDir: string, trail: ReplayTrail): string | null {
  try {
    const dir = join(nxMkDir, 'replays', trail.runId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${trail.replayId}.json`), JSON.stringify(trail, null, 2), 'utf8')
    return trail.replayId
  } catch {
    return null
  }
}

export interface ReplayTrailSummary {
  replayId: string
  verdict: ReplayVerdict
  ok: boolean
  status: number | 'replay-error' | null
  createdAt: string
}

/** 留痕列表：损坏文件跳过（与 SSE E7 同族语义），createdAt 降序 */
export function listReplays(nxMkDir: string, runId: string): ReplayTrailSummary[] {
  const dir = join(nxMkDir, 'replays', runId)
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: ReplayTrailSummary[] = []
  for (const f of files) {
    try {
      const t = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Partial<ReplayTrail>
      if (typeof t.replayId !== 'string' || typeof t.verdict !== 'string') continue
      out.push({
        replayId: t.replayId,
        verdict: t.verdict as ReplayVerdict,
        ok: t.response?.ok === true,
        status: t.response?.status ?? null,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
      })
    } catch {
      /* 损坏留痕跳过 */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}
```

- [ ] **Step 5: 实现 `packages/dashboard/src/server/routes/replay.ts`**

```ts
/**
 * POST /api/runs/:runId/replay/request/:requestId、GET /api/runs/:runId/replays（spec §2.3）。
 * trace 来源同 requests.ts 详情路由：db 行优先 → report 摘要回落（同源防御路径）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { RouteContext } from '../types.js'
import { reportForRun } from '../store/report-reader.js'
import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
import { Queries } from '../store/queries.js'
import { classifyReplay, performReplay, makeReplayId, writeReplayTrail, listReplays } from '../replay.js'
import type { ReplayResponse, ReplaysListResponse } from '../../shared/api-types.js'

function busy503(reply: FastifyReply): { handled: true } {
  void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
  return { handled: true }
}

export function registerReplayRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const readerOpts = { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS }

  app.post('/api/runs/:runId/replay/request/:requestId', async (req, reply) => {
    const { runId, requestId } = req.params as { runId: string; requestId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    // trace 解析（db 行优先 → report 回落）——只需 method/url
    let method: string | undefined
    let url: string | undefined
    try {
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
      try {
        const trace = reader ? new Queries(reader).getTrace(runId, requestId) : undefined
        if (trace) {
          method = trace.method
          url = trace.url
        }
      } finally {
        reader?.close()
      }
    } catch (err) {
      if (err instanceof DbBusyError) return busy503(reply)
      throw err
    }
    if (!method || !url) {
      const summary = reportForRun(ctx.nxMkDir, runId)?.requests.find((r) => r.requestId === requestId)
      if (!summary) return reply.code(404).send({ error: `unknown request: ${requestId}` })
      method = summary.method ?? 'GET'
      url = summary.url ?? ''
    }
    // R1：服务端分类；E1 blocked → 403
    const cls = classifyReplay(method, url)
    if (cls.verdict === 'blocked') {
      return reply.code(403).send({ error: `replay blocked: ${cls.reason}`, verdict: cls.verdict })
    }
    // V4：idempotent 与 unsafe 同门 —— 无 confirm → 409（E2）
    const body = (req.body ?? {}) as { confirm?: boolean }
    if (body.confirm !== true) {
      return reply.code(409).send({ error: 'unsafe method requires confirmation', verdict: cls.verdict })
    }
    // V3：PUT 复刻生成幂等键；其余无附加头
    const key = cls.verdict === 'idempotent' ? `replay-${runId}-${requestId}-${Date.now()}` : null
    const outcome = await performReplay(method, url, key)
    const replayId = makeReplayId(requestId)
    const writtenId = writeReplayTrail(ctx.nxMkDir, {
      replayId,
      runId,
      requestId,
      verdict: cls.verdict,
      reason: cls.reason,
      createdAt: new Date().toISOString(),
      request: { method, url, headers: key ? { 'idempotency-key': key } : {}, reqBody: '' },
      response: {
        ok: outcome.ok,
        status: outcome.status,
        durationMs: outcome.durationMs,
        bodyPreview: outcome.bodyPreview,
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      },
    })
    const res: ReplayResponse = {
      replayId: writtenId,
      verdict: cls.verdict,
      reason: cls.reason,
      ok: outcome.ok,
      status: outcome.status,
      durationMs: outcome.durationMs,
      bodyPreview: outcome.bodyPreview,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    }
    return res
  })

  app.get('/api/runs/:runId/replays', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    const res: ReplaysListResponse = { replays: listReplays(ctx.nxMkDir, runId) }
    return res
  })
}
```

- [ ] **Step 6: 注册路由（server/index.ts）**

index.ts import 区加 `import { registerReplayRoutes } from './routes/replay.js'`，`registerIgnoredRoutes(app, ctx)` 之后加一行：

```ts
  registerReplayRoutes(app, ctx)
```

同步更新 index.ts 头注释的「7 条只读 /api 路由」为「只读路由 + Phase 4.5 可操作路由（replay/events/plugins/manifest）」。

- [ ] **Step 7: 跑测试确认通过 + 全套绿屏 + 构建**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/replay.test.ts` → PASS
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run` → 全绿
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH corepack pnpm -F @nx-mk/dashboard build` → 双构建通过
Run: `wc -l packages/dashboard/src/server/replay.ts packages/dashboard/src/server/routes/replay.ts` → 均 ≤400

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/server/replay.ts packages/dashboard/src/server/routes/replay.ts packages/dashboard/src/server/index.ts packages/dashboard/src/shared/api-types.ts packages/dashboard/src/__tests__/replay.test.ts
git commit -m "feat(dashboard): Replay Request 路由 —— 服务端安全三分类 + fetch 复刻 + .nx-mk/replays/ 留痕"
```

---

## Task 4: dashboard server — events.jsonl tail → SSE 桥（R9/E6/E7）

**Files:**
- Create: `packages/dashboard/src/server/event-tail.ts`
- Create: `packages/dashboard/src/server/routes/events.ts`
- Modify: `packages/dashboard/src/server/index.ts`（注册路由）
- Test: `packages/dashboard/src/__tests__/event-tail.test.ts`（新建）

**Interfaces:**
- Consumes: `.nx-mk/runs/<runId>/events.jsonl`（kernel event-bus 追加写，一行一 JSON）；RouteContext
- Produces: `EventTail` 类（`new EventTail({nxMkDir, pollMs?, useWatch?, runId?}, onEvent)` + `start()/stop()/drain()`）、`mapRawEvent(runId, raw): TailEvent | null`、`TailEvent` 三型（stage:start/stage:done/agent:iteration —— V1 裁定）、路由 `GET /api/events`（SSE，`?runId=` 可选过滤）。Task 6 的 useEventSource 消费 SSE `data:` 行 = `TailEvent` JSON。

- [ ] **Step 1: 写失败测试**

新建 `packages/dashboard/src/__tests__/event-tail.test.ts`：

```ts
/**
 * event-tail 测试（Phase 4.5）：JSONL 追加 → 事件映射（V1 三类）/ 未知 type 跳过（R10）/
 * 损坏行跳过（E7）/ 残行等待补全 / 轮询降级等价（E6）/ runId 过滤 / SSE 端到端。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { EventTail, mapRawEvent, type TailEvent } from '../server/event-tail.js'
import { buildServer } from '../server/index.js'

const PHASE_START = JSON.stringify({ type: 'phase:start', phase: 'run', timestamp: '2026-09-20T10:00:00.000Z' })
const PHASE_END = JSON.stringify({ type: 'phase:end', phase: 'run', durationMs: 123 })
const TURN_END = JSON.stringify({ type: 'turn:end', turn: 2, progress: 'improved', coverage: { ratio: 0.5 } })
const TURN_START = JSON.stringify({ type: 'turn:start', turn: 1, idleTurns: 0 }) // 不在三类映射内
const PLUGIN_LOADED = JSON.stringify({ type: 'plugin:loaded', name: 'x', version: '1' }) // 同上

describe('mapRawEvent（V1 三类映射）', () => {
  it('phase:start → stage:start；phase:end → stage:done；turn:end → agent:iteration', () => {
    expect(mapRawEvent('r1', JSON.parse(PHASE_START))).toEqual({
      kind: 'stage:start', runId: 'r1', phase: 'run', timestamp: '2026-09-20T10:00:00.000Z',
    })
    expect(mapRawEvent('r1', JSON.parse(PHASE_END))).toEqual({
      kind: 'stage:done', runId: 'r1', phase: 'run', durationMs: 123,
    })
    expect(mapRawEvent('r1', JSON.parse(TURN_END))).toEqual({
      kind: 'agent:iteration', runId: 'r1', turn: 2, progress: 'improved', coverageRatio: 0.5,
    })
  })
  it('未知 type / 损坏行 / 非对象 → null（R10/E7）', () => {
    expect(mapRawEvent('r1', JSON.parse(TURN_START))).toBeNull()
    expect(mapRawEvent('r1', JSON.parse(PLUGIN_LOADED))).toBeNull()
    expect(mapRawEvent('r1', { type: 'future:event', x: 1 })).toBeNull()
    expect(mapRawEvent('r1', 'not-an-object')).toBeNull()
    expect(mapRawEvent('r1', null)).toBeNull()
  })
  it('turn:end 缺 coverage → coverageRatio null；缺 progress → unknown', () => {
    const e = mapRawEvent('r1', { type: 'turn:end', turn: 1 })
    expect(e).toEqual({ kind: 'agent:iteration', runId: 'r1', turn: 1, progress: 'unknown', coverageRatio: null })
  })
})

describe('EventTail（轮询路径，pollMs=10）', () => {
  let dir: string
  let eventsFile: string
  let tail: EventTail
  let seen: TailEvent[]

  beforeEach(() => {
    dir = mkNxMk()
    eventsFile = join(dir, 'runs', 'run_a', 'events.jsonl')
    seen = []
    tail = new EventTail({ nxMkDir: dir, pollMs: 10, useWatch: false }, (e) => seen.push(e))
  })
  afterEach(() => {
    tail.stop()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  function mkNxMk(): string {
    const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
    const d = mkdtempSync(join(__dirname, 'nx-mk-tail-')) // 用仓库内 tmp，Windows tmpdir 路径太长时 watch 更稳
    mkdirSync(join(d, 'runs', 'run_a'), { recursive: true })
    writeFileSync(join(d, 'runs', 'run_a', 'events.jsonl'), '')
    return d
  }

  it('start 后追加的完整行被增量推送；起点是当前 EOF（不重放历史）', async () => {
    appendFileSync(eventsFile, PHASE_START + '\n') // start 前的历史 → 不推
    tail.start()
    appendFileSync(eventsFile, PHASE_END + '\n' + TURN_END + '\n')
    await viWaitFor(() => seen.length >= 2)
    expect(seen.map((e) => e.kind)).toEqual(['stage:done', 'agent:iteration'])
  })

  it('损坏行与未知 type 不炸流（E7/R10）', async () => {
    tail.start()
    appendFileSync(eventsFile, '{broken json\n' + PLUGIN_LOADED + '\n' + PHASE_END + '\n')
    await viWaitFor(() => seen.length >= 1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.kind).toBe('stage:done')
  })

  it('残行：无换行结尾不推送，补全后推送一次', async () => {
    tail.start()
    appendFileSync(eventsFile, PHASE_END) // 无 \n
    await sleep(40)
    expect(seen).toHaveLength(0)
    appendFileSync(eventsFile, '\n') // 补全
    await viWaitFor(() => seen.length >= 1)
    expect(seen).toHaveLength(1)
  })

  it('runId 过滤只透传目标 run', async () => {
    mkdirSync(join(dir, 'runs', 'run_b'), { recursive: true })
    writeFileSync(join(dir, 'runs', 'run_b', 'events.jsonl'), '')
    const filtered = new EventTail({ nxMkDir: dir, pollMs: 10, useWatch: false, runId: 'run_a' }, (e) => seen.push(e))
    tail.stop()
    tail = filtered
    filtered.start()
    appendFileSync(join(dir, 'runs', 'run_b', 'events.jsonl'), PHASE_END + '\n')
    appendFileSync(eventsFile, TURN_END + '\n')
    await viWaitFor(() => seen.length >= 1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.kind).toBe('agent:iteration')
  })

  it('runs 目录缺席时 start 不炸，目录后建仍被轮询捕获（E6 降级等价）', async () => {
    rmSync(join(dir, 'runs'), { recursive: true, force: true })
    const t = new EventTail({ nxMkDir: dir, pollMs: 10, useWatch: false }, (e) => seen.push(e))
    tail.stop()
    tail = t
    t.start()
    mkdirSync(join(dir, 'runs', 'run_c'), { recursive: true })
    appendFileSync(join(dir, 'runs', 'run_c', 'events.jsonl'), PHASE_END + '\n')
    await viWaitFor(() => seen.length >= 1)
    expect(seen[0]!.kind).toBe('stage:done')
  })
})

describe('GET /api/events（SSE 端到端，真 listen）', () => {
  it('fixture events.jsonl 追加 → 客户端收到 data 行', async () => {
    const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
    const dir = mkdtempSync(join(__dirname, 'nx-mk-sse-'))
    mkdirSync(join(dir, 'runs', 'run_a'), { recursive: true })
    writeFileSync(join(dir, 'runs', 'run_a', 'events.jsonl'), '')
    const app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`

    const controller = new AbortController()
    const res = await fetch(`${base}/api/events?runId=run_a`, { signal: controller.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // retry 行先到
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const first = await reader.read()
    expect(decoder.decode(first.value)).toContain('retry: 2000')

    appendFileSync(join(dir, 'runs', 'run_a', 'events.jsonl'), PHASE_END + '\n')
    let dataLine = ''
    for (let i = 0; i < 50 && !dataLine; i++) {
      const chunk = await reader.read()
      if (chunk.done) break
      const text = decoder.decode(chunk.value)
      const m = text.split('\n').find((l) => l.startsWith('data: '))
      if (m) dataLine = m
    }
    expect(JSON.parse(dataLine.slice('data: '.length))).toEqual({
      kind: 'stage:done', runId: 'run_a', phase: 'run', durationMs: 123,
    })
    controller.abort()
    await app.close()
    rmSync(dirname(dir), { recursive: true, force: true })
  }, 15_000)
})

// —— 小工具：轮询等待 + 睡眠（node 环境无 vi.useFakeTimers 的 stream 兼容问题，用真实短等待）——
import { vi } from 'vitest'
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
async function viWaitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return
    await sleep(10)
  }
  throw new Error('viWaitFor timeout')
}
```

注意：`require` 在 ESM 测试文件不可用——把 `mkdtempSync` 提到文件顶部静态 import（与其它 node:fs 导入合并），去掉 require 写法。此为书写示例时的省略，实现时必须用静态 import。

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/event-tail.test.ts`
Expected: FAIL — cannot find module '../server/event-tail.js'

- [ ] **Step 3: 实现 `packages/dashboard/src/server/event-tail.ts`**

```ts
/**
 * events.jsonl 文件 tail（Phase 4.5 spec R9/E6/E7）：fs.watch(runs, {recursive:true})
 * 驱动增量 drain；watch 不可用/出错降级 500ms 轮询——行为等价。
 * V1 裁定：SSE 三类映射 stage:start←phase:start、stage:done←phase:end、
 * agent:iteration←turn:end；request:captured 无内核实时源（采集走
 * collector→report→analyzer 管道，不经事件总线），推 Phase 6 RunState。
 * 起点 = 各文件当前 EOF（live-only，不重放历史）；残行等补全；损坏行跳过（E7）；
 * 未知 type 忽略（R10）。
 */
import { watch, existsSync, readdirSync, readFileSync, statSync, type FSWatcher } from 'node:fs'
import { join, relative } from 'node:path'

/** SSE 事件（spec U4 的 v0 三类；request:captured 见文件头 V1 裁定） */
export type TailEvent =
  | { kind: 'stage:start'; runId: string; phase: string; timestamp: string }
  | { kind: 'stage:done'; runId: string; phase: string; durationMs: number }
  | { kind: 'agent:iteration'; runId: string; turn: number; progress: string; coverageRatio: number | null }

export interface EventTailOptions {
  nxMkDir: string
  /** 降级轮询间隔（默认 500ms；测试注小值） */
  pollMs?: number
  /** 测试缝：false 强制轮询路径（跳过 watch） */
  useWatch?: boolean
  /** 只透传该 run 的事件（缺省全部） */
  runId?: string
}

type RawKernelEvent = { type?: unknown; [k: string]: unknown }

/** JSONL 原始行（已 JSON.parse）→ SSE 事件；不映射/形状残缺 → null */
export function mapRawEvent(runId: string, raw: unknown): TailEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as RawKernelEvent
  switch (e.type) {
    case 'phase:start':
      if (typeof e.phase !== 'string' || typeof e.timestamp !== 'string') return null
      return { kind: 'stage:start', runId, phase: e.phase, timestamp: e.timestamp }
    case 'phase:end':
      if (typeof e.phase !== 'string' || typeof e.durationMs !== 'number') return null
      return { kind: 'stage:done', runId, phase: e.phase, durationMs: e.durationMs }
    case 'turn:end': {
      if (typeof e.turn !== 'number') return null
      const cov = e.coverage as { ratio?: unknown } | undefined
      return {
        kind: 'agent:iteration',
        runId,
        turn: e.turn,
        progress: typeof e.progress === 'string' ? e.progress : 'unknown',
        coverageRatio: typeof cov?.ratio === 'number' ? cov.ratio : null,
      }
    }
    default:
      return null // R10：未知 type 忽略（向前兼容）
  }
}

export class EventTail {
  private offsets = new Map<string, number>() // events.jsonl 绝对路径 → 已消费字节
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false

  constructor(
    private readonly opts: EventTailOptions,
    private readonly onEvent: (e: TailEvent) => void,
  ) {}

  start(): void {
    // 起点 = 当前 EOF：live-only，不重放历史（长 run 不洪水）
    for (const f of this.listEventFiles()) this.offsets.set(f, this.sizeOf(f))
    const runsDir = join(this.opts.nxMkDir, 'runs')
    if ((this.opts.useWatch ?? true) && this.tryWatch(runsDir)) return
    this.timer = setInterval(() => this.drain(), this.opts.pollMs ?? 500)
  }

  /** E6：watch 建立失败 → false，调用方落轮询；运行期 watch error 也转轮询 */
  private tryWatch(runsDir: string): boolean {
    try {
      if (!existsSync(runsDir)) return false // runs 目录未建（首次 run 前）→ 直接轮询，后建目录靠轮询发现
      this.watcher = watch(runsDir, { recursive: true }, () => this.drain())
      this.watcher.on('error', () => this.fallbackToPoll())
      return true
    } catch {
      return false
    }
  }

  private fallbackToPoll(): void {
    if (this.timer !== null || this.stopped) return
    this.watcher?.close()
    this.watcher = null
    this.timer = setInterval(() => this.drain(), this.opts.pollMs ?? 500)
  }

  /** 增量消费所有 events.jsonl：offset→EOF；残行回退 offset 等下次 */
  drain(): void {
    if (this.stopped) return
    for (const file of this.listEventFiles()) {
      const size = this.sizeOf(file)
      const from = this.offsets.get(file) ?? size // 新发现的文件从当前 EOF 起（live-only）
      if (size <= from) continue
      let buf: Buffer
      try {
        buf = readFileSync(file)
      } catch {
        continue // 文件消失竞态容忍
      }
      const chunk = buf.subarray(from).toString('utf8')
      const lines = chunk.split('\n')
      if (!chunk.endsWith('\n')) {
        // 残行：offset 回退到残行起点，等补全后再消费
        const last = lines[lines.length - 1] ?? ''
        this.offsets.set(file, buf.length - Buffer.byteLength(last, 'utf8'))
        lines.pop()
      } else {
        this.offsets.set(file, buf.length)
      }
      const runId = runIdFromPath(this.opts.nxMkDir, file)
      for (const line of lines) {
        if (line.trim() === '') continue
        let raw: unknown
        try {
          raw = JSON.parse(line)
        } catch {
          continue // E7：损坏行跳过，不炸流
        }
        const evt = mapRawEvent(runId, raw)
        if (evt !== null && (this.opts.runId === undefined || this.opts.runId === evt.runId)) {
          this.onEvent(evt)
        }
      }
    }
  }

  private listEventFiles(): string[] {
    const runsDir = join(this.opts.nxMkDir, 'runs')
    if (!existsSync(runsDir)) return []
    try {
      return readdirSync(runsDir)
        .map((n) => join(runsDir, n, 'events.jsonl'))
        .filter((f) => existsSync(f))
    } catch {
      return []
    }
  }

  private sizeOf(file: string): number {
    try {
      return statSync(file).size
    } catch {
      return 0
    }
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }
}

/** runs/<runId>/events.jsonl → runId（Windows 反斜杠兼容） */
function runIdFromPath(nxMkDir: string, file: string): string {
  const rel = relative(join(nxMkDir, 'runs'), file)
  return rel.split(/[\\/]/)[0] ?? ''
}
```

- [ ] **Step 4: 实现 `packages/dashboard/src/server/routes/events.ts`**

```ts
/**
 * GET /api/events（spec §2.1 SSE）：text/event-stream；?runId= 过滤单 run。
 * reply.hijack 后写 raw 流；客户端断开 → tail.stop() + 心跳清理。
 * 15s 心跳注释行防代理/空闲超时掐断。
 */
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { EventTail } from '../event-tail.js'

export function registerEventRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/events', (req, reply) => {
    const q = req.query as { runId?: string }
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    raw.write('retry: 2000\n\n')
    const tail = new EventTail({ nxMkDir: ctx.nxMkDir, ...(q.runId !== undefined ? { runId: q.runId } : {}) }, (evt) => {
      if (raw.destroyed) return
      raw.write(`data: ${JSON.stringify(evt)}\n\n`)
    })
    tail.start()
    const heartbeat = setInterval(() => {
      if (!raw.destroyed) raw.write(': ping\n\n')
    }, 15_000)
    req.raw.on('close', () => {
      clearInterval(heartbeat)
      tail.stop()
      if (!raw.writableEnded) raw.end()
    })
  })
}
```

- [ ] **Step 5: 注册路由（server/index.ts）**

import 区加 `import { registerEventRoutes } from './routes/events.js'`，Task 3 加的 `registerReplayRoutes(app, ctx)` 后加 `registerEventRoutes(app, ctx)`。

- [ ] **Step 6: 跑测试确认通过 + 全套绿屏 + 构建**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/event-tail.test.ts` → PASS（SSE 端到端用例给了 15s 超时，Windows listen 竞态偶发可重跑一次确认）
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run` → 全绿
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH corepack pnpm -F @nx-mk/dashboard build` → 通过
Run: `wc -l packages/dashboard/src/server/event-tail.ts` → ≤400

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/server/event-tail.ts packages/dashboard/src/server/routes/events.ts packages/dashboard/src/server/index.ts packages/dashboard/src/__tests__/event-tail.test.ts
git commit -m "feat(dashboard): events.jsonl tail → SSE 桥 —— V1 三类映射 + watch 降级轮询（R9/E6/E7）"
```

---

## Task 5: dashboard server — /api/plugins 只读装配 + /api/runs/:runId/manifest

**Files:**
- Create: `packages/dashboard/src/server/store/plugins-reader.ts`
- Create: `packages/dashboard/src/server/routes/plugins.ts`
- Create: `packages/dashboard/src/server/routes/manifest.ts`
- Modify: `packages/dashboard/src/server/index.ts`（注册两路由）
- Modify: `packages/dashboard/src/shared/api-types.ts`（追加类型）
- Test: `packages/dashboard/src/__tests__/plugins-manifest-routes.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `.nx-mk/plugins-manifest.json` 形状（`{generatedAt, plugins: [{name, version, enabled, config, configSchema}]}`）；Task 2 的 `.nx-mk/runs/<runId>/manifest.json` 快照
- Produces: `readPluginsManifest(nxMkDir): PluginsManifestView`（`{plugins: [{name, version, enabled, config, configSchema}], stale: boolean}`）；路由 `GET /api/plugins`（返回 `{plugins, stale}`）、`GET /api/runs/:runId/manifest`（返回 manifest 原样）。api-types 新增 `PluginsResponse`/`PluginEntryView`/`ManifestResponse`（下方原文）——Task 7 的两个页面直接消费。

- [ ] **Step 1: api-types 追加**

```ts
// —— Phase 4.5：plugin settings 只读（spec R6-R8/E4/E5；V5 config 语义）——

export interface PluginEntryView {
  name: string
  version: string
  enabled: boolean
  /** 全量 ResolvedConfig JSON 快照（V5） */
  config: unknown
  /** JSON Schema 对象；无/不可序列化 → null（UI 显「No schema exposed」，R8/E5） */
  configSchema: Record<string, unknown> | null
}

export interface PluginsResponse {
  plugins: PluginEntryView[]
  /** true = plugins-manifest.json 缺失/形状不过（E4）：UI 显「kernel 未产出清单」 */
  stale: boolean
}

// —— Phase 4.5：manifest 浏览器（spec U6/E8；§16 ApiManifest 结构投影，不引 manifest-schema 依赖）——

export interface ManifestEndpointView {
  id: string
  method: string
  path: string
  operationId?: string
  summary?: string
  tags?: string[]
}

export interface ManifestFieldView {
  id: string
  endpointId: string
  direction: string
  status?: string
  path: string
  normalizedPath: string
  name: string
  type: string
  required?: boolean
  nullable?: boolean
  description?: string
  enum?: string[]
}

export interface ManifestResponse {
  version: string
  source: { type: string; input: string; hash: string }
  generatedAt: string
  schemas: Record<string, unknown>
  fields: ManifestFieldView[]
  endpoints: ManifestEndpointView[]
}
```

- [ ] **Step 2: 写失败测试**

新建 `packages/dashboard/src/__tests__/plugins-manifest-routes.test.ts`：

```ts
/**
 * /api/plugins + /api/runs/:runId/manifest 路由测试（Phase 4.5）：
 * E4 stale 降级 / 逐条 sanitize / E8 404 / 形状门。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { buildServer } from '../server/index.js'
import { makeNxMkDir } from './fixtures.js'
import type { FastifyInstance } from 'fastify'
import type { PluginsResponse, ManifestResponse } from '../shared/api-types.js'

const VALID_MANIFEST_FILE = {
  generatedAt: '2026-09-20T10:00:00.000Z',
  plugins: [
    { name: '@nx-mk/plugin-swagger', version: '0.1.0', enabled: true, config: { logLevel: 'info' }, configSchema: { type: 'object' } },
    { name: 'bare-plugin', version: '1.0.0', enabled: true, config: null, configSchema: null },
    { name: 42, version: 'bad' }, // 非法条目 → 跳过
  ],
}

const VALID_RUN_MANIFEST = {
  version: '1',
  source: { type: 'openapi', input: 'openapi.json', hash: 'h1' },
  generatedAt: '2026-09-20T09:00:00.000Z',
  schemas: {},
  fields: [
    { id: 'f1', endpointId: 'e1', direction: 'response', path: 'data.id', normalizedPath: 'data.id', name: 'id', type: 'integer', required: true },
  ],
  endpoints: [{ id: 'e1', method: 'GET', path: '/users/{id}' }],
}

describe('GET /api/plugins（E4/E5/R8）', () => {
  let dir: string
  let app: FastifyInstance

  function build(): void {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
  }
  beforeEach(() => {
    dir = makeNxMkDir([{ runId: 'run_a' }])
  })
  afterEach(async () => {
    await app.close()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('清单在 → 逐条返回；非法条目跳过；configSchema null 保留', async () => {
    writeFileSync(join(dir, 'plugins-manifest.json'), JSON.stringify(VALID_MANIFEST_FILE))
    build()
    const res = await app.inject({ method: 'GET', url: '/api/plugins' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as PluginsResponse
    expect(body.stale).toBe(false)
    expect(body.plugins).toHaveLength(2)
    expect(body.plugins[0]!.name).toBe('@nx-mk/plugin-swagger')
    expect(body.plugins[0]!.configSchema).toEqual({ type: 'object' })
    expect(body.plugins[1]!.configSchema).toBeNull()
  })

  it('文件缺失 / 形状非法 / JSON 损坏 → {plugins: [], stale: true}（E4）', async () => {
    build()
    expect((await app.inject({ method: 'GET', url: '/api/plugins' })).json() as PluginsResponse).toEqual({ plugins: [], stale: true })
    writeFileSync(join(dir, 'plugins-manifest.json'), '{oops')
    expect((await app.inject({ method: 'GET', url: '/api/plugins' })).json() as PluginsResponse).toEqual({ plugins: [], stale: true })
    writeFileSync(join(dir, 'plugins-manifest.json'), JSON.stringify({ nope: true }))
    expect((await app.inject({ method: 'GET', url: '/api/plugins' })).json() as PluginsResponse).toEqual({ plugins: [], stale: true })
  })
})

describe('GET /api/runs/:runId/manifest（E8）', () => {
  let dir: string
  let app: FastifyInstance

  function build(): void {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
  }
  beforeEach(() => {
    dir = makeNxMkDir([{ runId: 'run_a' }])
  })
  afterEach(async () => {
    await app.close()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('快照在 → 原样透传', async () => {
    writeFileSync(join(dir, 'runs', 'run_a', 'manifest.json'), JSON.stringify(VALID_RUN_MANIFEST))
    build()
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/manifest' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ManifestResponse
    expect(body.endpoints).toHaveLength(1)
    expect(body.fields[0]!.path).toBe('data.id')
  })

  it('快照缺失 / JSON 损坏 / 形状不过（{}）→ 404（E8）', async () => {
    build()
    expect((await app.inject({ method: 'GET', url: '/api/runs/run_a/manifest' })).statusCode).toBe(404)
    writeFileSync(join(dir, 'runs', 'run_a', 'manifest.json'), '{oops')
    expect((await app.inject({ method: 'GET', url: '/api/runs/run_a/manifest' })).statusCode).toBe(404)
    writeFileSync(join(dir, 'runs', 'run_a', 'manifest.json'), '{}')
    expect((await app.inject({ method: 'GET', url: '/api/runs/run_a/manifest' })).statusCode).toBe(404)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/plugins-manifest-routes.test.ts`
Expected: FAIL — cannot find module '../server/store/plugins-reader.js'；路由 404

- [ ] **Step 4: 实现 `packages/dashboard/src/server/store/plugins-reader.ts`**

```ts
/**
 * plugins-manifest.json 只读读取（spec R7/E4）：形状门控 + 逐条 sanitize，
 * 缺失/非法 → stale 降级。语义同构 report-reader.ts（缺失按空处理，不炸路由）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginEntryView, PluginsResponse } from '../../shared/api-types.js'

export type PluginsManifestView = PluginsResponse

export function readPluginsManifest(nxMkDir: string): PluginsManifestView {
  let raw: string
  try {
    raw = readFileSync(join(nxMkDir, 'plugins-manifest.json'), 'utf8')
  } catch {
    return { plugins: [], stale: true }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { plugins: [], stale: true }
  }
  const list = (parsed as { plugins?: unknown } | null)?.plugins
  if (!Array.isArray(list)) return { plugins: [], stale: true }
  const plugins: PluginEntryView[] = []
  for (const item of list) {
    const e = sanitizeEntry(item)
    if (e !== null) plugins.push(e)
  }
  return { plugins, stale: false }
}

function sanitizeEntry(v: unknown): PluginEntryView | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.name !== 'string' || typeof o.version !== 'string') return null
  return {
    name: o.name,
    version: o.version,
    enabled: o.enabled === true,
    config: o.config ?? null,
    configSchema: isPlainObject(o.configSchema) ? (o.configSchema as Record<string, unknown>) : null, // E5/R8
  }
}

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
```

- [ ] **Step 5: 实现 `routes/plugins.ts` 与 `routes/manifest.ts`**

`routes/plugins.ts`：

```ts
/**
 * GET /api/plugins（spec R6）：只读装配 plugins-manifest.json（kernel R7 产物）。
 * 无写回（R6：PATCH 推 v1）。
 */
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { readPluginsManifest } from '../store/plugins-reader.js'

export function registerPluginRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/plugins', async () => readPluginsManifest(ctx.nxMkDir))
}
```

`routes/manifest.ts`：

```ts
/**
 * GET /api/runs/:runId/manifest（spec U6/E8）：per-run manifest 快照原样透传。
 * 缺失/JSON 损坏/形状不过 → 404（对齐既有 run 路由语义；快照是 Task 2 的 CLI 产物，
 * 旧 run 与 manifest 无效的 run 天然无快照 —— 404 是诚实语义）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import type { ManifestResponse } from '../../shared/api-types.js'

function isManifestShaped(v: unknown): v is ManifestResponse {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.fields) && Array.isArray(o.endpoints) && typeof o.version === 'string'
}

export function registerManifestRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/runs/:runId/manifest', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    let raw: string
    try {
      raw = readFileSync(join(ctx.nxMkDir, 'runs', runId, 'manifest.json'), 'utf8')
    } catch {
      return reply.code(404).send({ error: `manifest not found for run: ${runId}` })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return reply.code(404).send({ error: `manifest not found for run: ${runId}` })
    }
    if (!isManifestShaped(parsed)) {
      return reply.code(404).send({ error: `manifest not found for run: ${runId}` })
    }
    return parsed
  })
}
```

- [ ] **Step 6: 注册路由（server/index.ts）**

import 区加两条，`registerEventRoutes(app, ctx)` 之后：

```ts
  registerPluginRoutes(app, ctx)
  registerManifestRoutes(app, ctx)
```

- [ ] **Step 7: 跑测试确认通过 + 全套绿屏 + 构建**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/plugins-manifest-routes.test.ts` → PASS
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run` → 全绿
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH corepack pnpm -F @nx-mk/dashboard build` → 通过

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/server/store/plugins-reader.ts packages/dashboard/src/server/routes/plugins.ts packages/dashboard/src/server/routes/manifest.ts packages/dashboard/src/server/index.ts packages/dashboard/src/shared/api-types.ts packages/dashboard/src/__tests__/plugins-manifest-routes.test.ts
git commit -m "feat(dashboard): /api/plugins 只读装配 + per-run manifest 路由（E4/E5/E8）"
```

---

## Task 6: UI — RequestDetail Replay 行 + useEventSource 实时刷新（R11）

**Files:**
- Modify: `packages/dashboard/src/ui/api.ts`（追加 postJson）
- Modify: `packages/dashboard/src/ui/hooks.ts`（追加 useEventSource）
- Modify: `packages/dashboard/src/ui/pages/RequestDetail.tsx`（追加 Replay section）
- Modify: `packages/dashboard/src/ui/pages/Overview.tsx` + `RunOverview.tsx`（SSE 触发 refresh）
- Test: `packages/dashboard/src/__tests__/ui-phase45.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 的 `POST /api/runs/:runId/replay/request/:requestId` + `ReplayResponse`；Task 4 的 `GET /api/events` + `TailEvent`
- Produces: `postJson<T>(path: string, body: unknown, fetchImpl?): Promise<T>`（api.ts 导出）；`useEventSource(path: string | null, onEvent?): {connected: boolean}`（hooks.ts 导出）。RequestDetail 渲染 `<h2>Replay</h2>` 区块与 `Replay request` 按钮。

- [ ] **Step 1: api.ts 追加 postJson**

在 `getJson` 之后追加：

```ts
/** POST JSON 的通用包装（Phase 4.5 replay 用）；错误处理与 getJson 同构 */
export async function postJson<T>(path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let errBody: unknown = null
    try {
      errBody = await res.json()
    } catch {
      // 空/非 JSON body 容忍
    }
    throw new ApiError(res.status, errBody)
  }
  return (await res.json()) as T
}
```

- [ ] **Step 2: hooks.ts 追加 useEventSource**

文件末尾追加（注意 node 测试环境无 EventSource——`typeof EventSource === 'undefined'` 守卫必须 first）：

```ts
/**
 * useEventSource（spec R11）：SSE 订阅 /api/events，onEvent 供页面触发立即 refresh。
 * 断线由浏览器 EventSource 自动重连（服务端 retry: 2000）；轮询通道保留（R11 不删）。
 * node 测试环境无 EventSource → 静默 no-op（connected:false），页面渲染不受影响。
 */
import { useEffect, useRef, useState } from 'react'

export interface SseState {
  connected: boolean
}

export function useEventSource(path: string | null, onEvent?: (evt: unknown) => void): SseState {
  const [connected, setConnected] = useState(false)
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent
  useEffect(() => {
    if (path === null || typeof EventSource === 'undefined') {
      setConnected(false)
      return
    }
    const es = new EventSource(path)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (m) => {
      try {
        cbRef.current?.(JSON.parse(m.data) as unknown)
      } catch {
        // 损坏事件忽略（E7 的 UI 侧对偶）
      }
    }
    return () => es.close()
  }, [path])
  return { connected }
}
```

- [ ] **Step 3: RequestDetail.tsx 追加 Replay section**

在文件 import 区追加：

```tsx
import { useState } from 'react'
import { postJson } from '../api'
import type { ReplayResponse } from '../../shared/api-types'
```

（`useState` 若已 import 则合并；`ApiError`/`usePolling` 已有。）

在组件返回 JSX 的 trace 表格 `</table>` 之后、Field hits `<div className="section">` 之前插入：

```tsx
      <ReplaySection runId={runId} requestId={requestId} />
```

文件末尾追加组件：

```tsx
/**
 * Replay 行（spec §2.1）：按钮 → POST 无 confirm；409 → 显确认门（V4：idempotent/unsafe 同门）；
 * 403 → blocked 文案；200 → verdict 徽章 + status/duration/bodyPreview。
 * 交互流程由路由测试覆盖（node 渲染环境无事件模拟）；此处 UI 只渲染状态机输出。
 */
function ReplaySection({ runId, requestId }: { runId: string; requestId: string }) {
  const [result, setResult] = useState<ReplayResponse | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async (confirm: boolean): Promise<void> => {
    setBusy(true)
    setErrorText(null)
    try {
      const res = await postJson<ReplayResponse>(`/api/runs/${runId}/replay/request/${requestId}`, confirm ? { confirm: true } : {})
      setResult(res)
      setNeedsConfirm(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNeedsConfirm(true)
      } else if (err instanceof ApiError) {
        setErrorText(err.detailMessage)
      } else {
        setErrorText('replay request failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section">
      <h2>Replay</h2>
      {result === null && !needsConfirm && (
        <button onClick={() => void send(false)} disabled={busy}>
          Replay request
        </button>
      )}
      {needsConfirm && (
        <p className="error">
          unsafe/idempotent method requires confirmation{' '}
          <button onClick={() => void send(true)} disabled={busy}>
            Confirm replay
          </button>
        </p>
      )}
      {errorText !== null && <p className="error">{errorText}</p>}
      {result !== null && (
        <p>
          <span className="badge">{result.verdict}</span>{' '}
          {result.status === 'replay-error' ? (
            <span className="error">replay-error: {result.error ?? 'network failure'}</span>
          ) : (
            <>
              ok={String(result.ok)} status={result.status ?? '—'}
              {result.durationMs != null ? ` ${result.durationMs}ms` : ''}
            </>
          )}
          {result.bodyPreview !== null && <pre>{result.bodyPreview}</pre>}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Overview / RunOverview 接 SSE 触发 refresh**

`Overview.tsx`：组件内找到 `const { data, error } = usePolling<...>(...)`（两段式拉取是两个 usePolling——取主列表那个的 `refresh`），解构加 `refresh`，组件体加：

```tsx
  // Phase 4.5（R11）：SSE 事件到达 → 立即 refresh（轮询保留，SSE 只是加速器）
  const { connected } = useEventSource('/api/events', () => refresh())
```

并在页面标题旁渲染在线徽章：`{connected ? <span className="badge">live</span> : null}`（插在 `<h1>…</h1>` 同一行后）。

`RunOverview.tsx`：同样处理，path 用 `` `/api/events?runId=${runId}` ``。

（`useEventSource` 从 `'../hooks'` import；两页面的 `refresh` 已由 usePolling 返回——若现有解构未取 refresh，补进解构即可。）

- [ ] **Step 5: 写渲染测试**

新建 `packages/dashboard/src/__tests__/ui-phase45.test.ts`：

```ts
/**
 * Phase 4.5 UI 渲染测试（node renderToString，无 jsdom）：
 * RequestDetail 含 Replay 区块 / useEventSource 无 EventSource 环境 no-op /
 * YAML 生成器类型分支归 Task 7 同文件扩展。
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

vi.mock('../ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/hooks')>()
  return {
    ...actual, // useEventSource 走真实现（node 无 EventSource → no-op 分支，正是要测的）
    usePolling: <T,>() => ({
      data: {
        trace: { id: 't', runId: 'run_a', traceId: 'req_1', scenarioId: null, dslStepId: null, endpointId: null, method: 'GET', url: 'http://api.local/users/1', path: '/users/1', status: 200, durationMs: 12, startedAt: null, endedAt: null, replayable: null, replaySafety: null, replayReason: null },
        hits: [],
        evidence: [],
      } as unknown as T,
      error: null,
      refresh: () => {},
    }),
  }
})

function renderPage(el: ReturnType<typeof createElement>): string {
  return renderToString(el).replace(/<!-- -->/g, '')
}

describe('Phase 4.5 UI render', () => {
  it('RequestDetail renders Replay section with button', async () => {
    const { RequestDetailPage } = await import('../ui/pages/RequestDetail')
    const html = renderPage(createElement(RequestDetailPage, { runId: 'run_a', requestId: 'req_1' }))
    expect(html).toContain('Replay')
    expect(html).toContain('Replay request')
  })

  it('Overview renders with useEventSource no-op branch (no EventSource in node)', async () => {
    const { OverviewPage } = await import('../ui/pages/Overview')
    const html = renderPage(createElement(OverviewPage, {}))
    expect(html).not.toContain('error 5')
    expect(typeof html).toBe('string')
  })
})
```

（第二个用例若 Overview 的 usePolling mock 形状与页面消费不匹配导致渲染异常，把该用例的 usePolling 返回调整为页面真实消费的最小形状——以 Overview.tsx 实际取的字段为准。）

- [ ] **Step 6: 跑测试 + 全套绿屏 + 构建**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/ui-phase45.test.ts` → PASS
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run` → 全绿
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH corepack pnpm -F @nx-mk/dashboard build` → 通过（vite UI 构建含新 hook）

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/ui/api.ts packages/dashboard/src/ui/hooks.ts packages/dashboard/src/ui/pages/RequestDetail.tsx packages/dashboard/src/ui/pages/Overview.tsx packages/dashboard/src/ui/pages/RunOverview.tsx packages/dashboard/src/__tests__/ui-phase45.test.ts
git commit -m "feat(dashboard/ui): Replay 行 + useEventSource 实时刷新 —— 轮询通道保留（R11）"
```

---

## Task 7: UI — PluginSettings（YAML 片段）+ ManifestBrowser（树 + schema 表）+ 路由

**Files:**
- Create: `packages/dashboard/src/ui/yaml-snippet.ts`
- Create: `packages/dashboard/src/ui/pages/PluginSettings.tsx`
- Create: `packages/dashboard/src/ui/pages/ManifestBrowser.tsx`
- Modify: `packages/dashboard/src/ui/router.tsx`（PageId + ROUTES）
- Modify: `packages/dashboard/src/ui/App.tsx`（import + 渲染分支 + nav）
- Modify: `packages/dashboard/src/ui/pages/RunOverview.tsx`（Manifest 页入口链接）
- Test: `packages/dashboard/src/__tests__/ui-phase45.test.ts`（追加）

**Interfaces:**
- Consumes: Task 5 的 `GET /api/plugins`（`PluginsResponse`）、`GET /api/runs/:runId/manifest`（`ManifestResponse`）；既有 `GET /api/runs/:runId/fields`（`FieldsListResponse`，policyStatus 来源）与 `GET /api/runs/:runId/requests`（called 判定来源）
- Produces: `yamlSnippet(entry: PluginEntryView): string`（纯函数）；路由 `#/settings/plugins`（PageId `settings`）、`#/runs/:runId/manifest`（PageId `manifest`）

- [ ] **Step 1: 写 yaml-snippet 纯函数 + 测试**

新建 `packages/dashboard/src/ui/yaml-snippet.ts`：

```ts
/**
 * configSchema 驱动的 YAML 片段生成器（spec R6/U3：只读 + 复制导出，不写回）。
 * v0 语义（V5）：插件从全局配置读字段，故片段是顶层键名列表；
 * 无 schema → 自由编辑提示注释（R8/E5 降级）。
 */
import type { PluginEntryView } from '../../shared/api-types.js'

interface SchemaLike {
  type?: unknown
  properties?: Record<string, { type?: unknown; description?: unknown; enum?: unknown }>
  required?: unknown
}

/** JSON Schema → YAML 键名占位片段（properties 顺序；required 标注；枚举给合法值） */
export function yamlSnippet(entry: PluginEntryView): string {
  if (entry.configSchema === null) {
    return `# ${entry.name}: no schema exposed — free-form config\n`
  }
  const schema = entry.configSchema as SchemaLike
  const props = schema.properties ?? {}
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === 'string') : [])
  const lines: string[] = [`# ${entry.name} (v${entry.version}) config snippet`]
  for (const [key, def] of Object.entries(props)) {
    const comment = typeof def.description === 'string' ? ` # ${def.description}` : ''
    const mark = required.has(key) ? '' : '?' // YAML optional-key 约定
    lines.push(`${key}${mark}: ${placeholder(def)}${comment}`)
  }
  if (lines.length === 1) lines.push('# (schema declares no properties)')
  return lines.join('\n') + '\n'
}

function placeholder(def: { type?: unknown; enum?: unknown }): string {
  if (Array.isArray(def.enum) && def.enum.length > 0 && typeof def.enum[0] === 'string') {
    return JSON.stringify(def.enum[0])
  }
  switch (def.type) {
    case 'string':
      return "''"
    case 'number':
    case 'integer':
      return '0'
    case 'boolean':
      return 'false'
    case 'array':
      return '[]'
    case 'object':
      return '{}'
    default:
      return 'null'
  }
}
```

`ui-phase45.test.ts` 追加：

```ts
import { yamlSnippet } from '../ui/yaml-snippet.js'

describe('yamlSnippet 类型分支（spec §4 UI 层）', () => {
  it('无 schema → 自由编辑提示（R8/E5）', () => {
    const out = yamlSnippet({ name: 'bare', version: '1.0.0', enabled: true, config: null, configSchema: null })
    expect(out).toContain('no schema exposed')
  })
  it('properties 按类型给占位；required 无 ?；enum 给首值', () => {
    const out = yamlSnippet({
      name: '@nx-mk/plugin-swagger',
      version: '0.1.0',
      enabled: true,
      config: null,
      configSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'swagger doc url' },
          retries: { type: 'integer' },
          strict: { type: 'boolean' },
          mode: { type: 'string', enum: ['read', 'live'] },
          tags: { type: 'array' },
        },
      },
    })
    expect(out).toContain('url: ')
    expect(out).not.toContain('url?:')
    expect(out).toContain('retries?: 0')
    expect(out).toContain('strict?: false')
    expect(out).toContain('"read"')
    expect(out).toContain('tags?: []')
    expect(out).toContain('# swagger doc url')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/ui-phase45.test.ts`
Expected: FAIL — cannot find module '../ui/yaml-snippet.js'

- [ ] **Step 3: 实现 yaml-snippet.ts（Step 1 代码）**，重跑该测试 → PASS

- [ ] **Step 4: PluginSettings 页面**

新建 `packages/dashboard/src/ui/pages/PluginSettings.tsx`：

```tsx
/**
 * /settings/plugins —— 插件配置只读 + YAML 片段（spec U3/R6-R8）。
 * stale → 「kernel 未产出清单」提示（E4）；无 schema → 「No schema exposed」（R8）；
 * 复制按钮走 navigator.clipboard（node 渲染环境不触发，浏览器生效）。
 */
import { useState } from 'react'
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import { yamlSnippet } from '../yaml-snippet'
import type { PluginsResponse } from '../../shared/api-types'

export function PluginSettingsPage() {
  const { data, error } = usePolling<PluginsResponse>('/api/plugins')
  if (error instanceof ApiError && error.status === 404) {
    return <p className="empty">Plugins endpoint not found.</p>
  }
  if (error instanceof ApiError) return <p className="error">error {error.status}: {error.detailMessage}</p>
  if (!data) return <p>loading…</p>
  if (data.stale) {
    return (
      <section>
        <h1>Plugins</h1>
        <p className="empty">kernel has not produced plugins-manifest.json yet — run once first.</p>
      </section>
    )
  }
  return (
    <section>
      <h1>Plugins</h1>
      <p className="empty">read-only — YAML snippets are for reference; write-back lands in v1.</p>
      {data.plugins.map((p) => (
        <PluginCard key={p.name} entry={p} />
      ))}
    </section>
  )
}

function PluginCard({ entry }: { entry: { name: string; version: string; enabled: boolean; configSchema: Record<string, unknown> | null; config: unknown } }) {
  const [copied, setCopied] = useState(false)
  const snippet = yamlSnippet(entry)
  return (
    <div className="section">
      <h2>
        {entry.name} <span className="badge">v{entry.version}</span> {entry.enabled ? <span className="badge">enabled</span> : null}
      </h2>
      {entry.configSchema === null ? <p className="empty">No schema exposed</p> : null}
      <pre>{snippet}</pre>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(snippet).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied!' : 'Copy YAML'}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: ManifestBrowser 页面**

新建 `packages/dashboard/src/ui/pages/ManifestBrowser.tsx`：

```tsx
/**
 * /runs/:runId/manifest —— manifest 树 + schema 表（spec U6/E8）。
 * 左：endpoints 列表（method 徽章 / called / 字段数）；右：选中 endpoint 的字段表
 * （字段 / 类型 / required / policyStatus 徽章）。policyStatus 来自 fields 路由；
 * called 判定 = requests 列表 path 命中。行锚点链 fields 页。
 */
import { useState } from 'react'
import { ApiError } from '../api'
import { usePolling } from '../hooks'
import type { ManifestResponse, FieldsListResponse, RequestsListResponse } from '../../shared/api-types'

export function ManifestBrowserPage({ runId }: { runId: string }) {
  const manifest = usePolling<ManifestResponse>(`/api/runs/${runId}/manifest`)
  const fields = usePolling<FieldsListResponse>(`/api/runs/${runId}/fields`)
  const requests = usePolling<RequestsListResponse>(`/api/runs/${runId}/requests`)
  const [selected, setSelected] = useState<string | null>(null)

  if (manifest.error instanceof ApiError && manifest.error.status === 404) {
    return <p className="empty">No manifest snapshot for this run (run predates Phase 4.5 or manifest was invalid).</p>
  }
  if (manifest.error instanceof ApiError) {
    return <p className="error">error {manifest.error.status}: {manifest.error.detailMessage}</p>
  }
  if (!manifest.data) return <p>loading…</p>

  const m = manifest.data
  // policyStatus 映射：normalizedPath → policyStatus（fields 路由失败时徽章显 —）
  const policyByPath = new Map<string, string>()
  if (fields.data) {
    for (const f of fields.data.fields) {
      if (!policyByPath.has(f.normalizedPath)) policyByPath.set(f.normalizedPath, f.policyStatus)
    }
  }
  const requestedPaths = new Set<string>()
  if (requests.data) {
    for (const r of requests.data.requests) {
      if (r.path) requestedPaths.add(r.path)
    }
  }
  const current = m.endpoints.find((e) => e.id === selected) ?? m.endpoints[0]
  const currentFields = current ? m.fields.filter((f) => f.endpointId === current.id) : []

  return (
    <section>
      <h1>Manifest</h1>
      <p>
        <a href={`#/runs/${runId}`}>← Run</a>
      </p>
      <p>
        {m.version} · {m.source.type} · {m.endpoints.length} endpoints · {m.fields.length} fields
      </p>
      <div className="section">
        <h2>Endpoints</h2>
        <table>
          <thead>
            <tr><th>method</th><th>path</th><th>called</th><th>fields</th></tr>
          </thead>
          <tbody>
            {m.endpoints.map((e) => (
              <tr
                key={e.id}
                onClick={() => setSelected(e.id)}
                style={{ cursor: 'pointer', fontWeight: current?.id === e.id ? 'bold' : 'normal' }}
              >
                <td><span className="badge">{e.method}</span></td>
                <td>{e.path}</td>
                <td>{requestedPaths.has(e.path) ? '✓' : '—'}</td>
                <td>{m.fields.filter((f) => f.endpointId === e.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current && (
        <div className="section">
          <h2>
            Schema — <span className="badge">{current.method}</span> {current.path}
          </h2>
          {currentFields.length === 0 ? (
            <p className="empty">no fields</p>
          ) : (
            <table>
              <thead>
                <tr><th>field</th><th>type</th><th>required</th><th>policy</th></tr>
              </thead>
              <tbody>
                {currentFields.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <a href={`#/runs/${runId}/fields`}>{f.normalizedPath}</a>
                    </td>
                    <td>{f.type}</td>
                    <td>{f.required === true ? 'required' : '—'}</td>
                    <td>
                      <span className="badge">{policyByPath.get(f.normalizedPath) ?? '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
```

（`FieldsListResponse.fields` 项的字段名以 shared/api-types.ts 既有定义为准——若 policyStatus 列名不同（如 `policyStatus` vs 其它），对齐既有类型，勿臆造。）

- [ ] **Step 6: 路由 + 导航接线**

`router.tsx`：

```tsx
export type PageId =
  | 'overview' | 'runs' | 'run' | 'requests' | 'request' | 'fields' | 'ignored' | 'manifest' | 'settings' | 'not-found'
```

ROUTES 追加两条（ignored 之后）：

```tsx
  { pattern: '/runs/:runId/manifest', page: 'manifest' },
  { pattern: '/settings/plugins', page: 'settings' },
```

`App.tsx`：import 两个新页面；渲染分支在 ignored 分支后追加：

```tsx
        {page === 'manifest' && <ManifestBrowserPage runId={params.runId ?? ''} key={JSON.stringify(params)} />}
        {page === 'settings' && <PluginSettingsPage key="settings" />}
```

nav 追加：

```tsx
        <a href="#/settings/plugins">Plugins</a>
```

`RunOverview.tsx`：在既有返回链接段落（与 RequestDetail 的 `← Requests` 同形的 `<a href={...}>` 处）追加：

```tsx
      <p>
        <a href={`#/runs/${runId}/manifest`}>Manifest browser</a>
      </p>
```

- [ ] **Step 7: 渲染测试追加**

`ui-phase45.test.ts` 追加（usePolling mock 需按 path 分发——把该文件顶部 mock 改为按 path 返回不同 data；若改动影响既有用例，给既有用例保留原返回）：

```ts
describe('Phase 4.5 pages render', () => {
  it('PluginSettings: stale → notice; entries → cards with No schema exposed', async () => {
    // 用 vi.doMock 或独立 mock 域比较繁琐；直接复用文件级 mock 的第二种形状：
    // 新建独立 describe 内用 vi.resetModules + 重设 mock（示意——实现时按文件内既有 mock 手法组织）
    const { PluginSettingsPage } = await import('../ui/pages/PluginSettings')
    const html = renderPage(createElement(PluginSettingsPage, {}))
    expect(typeof html).toBe('string')
    expect(html).toContain('Plugins')
  })

  it('ManifestBrowser renders endpoints table + schema section', async () => {
    const { ManifestBrowserPage } = await import('../ui/pages/ManifestBrowser')
    const html = renderPage(createElement(ManifestBrowserPage, { runId: 'run_a' }))
    expect(html).toContain('Manifest')
    expect(html).toContain('Endpoints')
  })
})
```

注意：文件级 `vi.mock('../ui/hooks')` 对整个文件生效——两个新页面消费的 `usePolling` 返回形状与 RequestDetail 用例不同。**实现手法**：把 mock 改为「按 path 分发」——

```ts
vi.mock('../ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/hooks')>()
  return {
    ...actual,
    usePolling: <T,>(path: string) => mockDataFor(path) as { data: T | null; error: null; refresh: () => void },
  }
})

function mockDataFor(path: string): unknown {
  if (path.includes('/requests/')) return { data: { trace: { /* 同既有 */ }, hits: [], evidence: [] }, error: null, refresh: () => {} }
  if (path === '/api/plugins') return { data: { plugins: [{ name: 'p', version: '1', enabled: true, config: null, configSchema: null }], stale: false }, error: null, refresh: () => {} }
  if (path.endsWith('/manifest')) return { data: { version: '1', source: { type: 'openapi', input: 'x', hash: 'h' }, generatedAt: '', schemas: {}, fields: [], endpoints: [{ id: 'e1', method: 'GET', path: '/users' }] }, error: null, refresh: () => {} }
  if (path.endsWith('/fields')) return { data: { fields: [] }, error: null, refresh: () => {} }
  if (path.endsWith('/requests')) return { data: { requests: [] }, error: null, refresh: () => {} }
  return { data: null, error: null, refresh: () => {} }
}
```

（`FieldsListResponse`/`RequestsListResponse` 的最小形状以 shared/api-types.ts 为准对齐。）

- [ ] **Step 8: 跑测试 + 全套绿屏 + 构建 + 行数**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/dashboard/src/__tests__/ui-phase45.test.ts` → PASS
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run` → 全绿
Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH corepack pnpm -F @nx-mk/dashboard build` → 通过
Run: `wc -l packages/dashboard/src/ui/pages/PluginSettings.tsx packages/dashboard/src/ui/pages/ManifestBrowser.tsx packages/dashboard/src/ui/yaml-snippet.ts` → 均 ≤400

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/ui/yaml-snippet.ts packages/dashboard/src/ui/pages/PluginSettings.tsx packages/dashboard/src/ui/pages/ManifestBrowser.tsx packages/dashboard/src/ui/router.tsx packages/dashboard/src/ui/App.tsx packages/dashboard/src/ui/pages/RunOverview.tsx packages/dashboard/src/__tests__/ui-phase45.test.ts
git commit -m "feat(dashboard/ui): PluginSettings YAML 片段 + ManifestBrowser 树/schema 表 + 路由接线"
```

---

## Task 8: 集成收尾 — README 验收步骤 + 只读铁律 grep 核查

**Files:**
- Modify: `README.md`（Phase 4.5 demo 手动验收步骤）
- Verify: 全仓测试 + 铁律 grep + spec §5 验收清单

**Interfaces:**
- Consumes: 全部前序任务的路由/页面名
- Produces: README 验收段；spec §5 四项验收的核查记录（写进 PR 描述）

- [ ] **Step 1: 只读铁律 grep 核查（spec §5.3）**

```bash
grep -rln "writeFileSync\|appendFileSync\|rmSync\|unlinkSync\|writeFile(" packages/dashboard/src/server/
```

Expected: **仅** `server/replay.ts`（R2 收缩项：replays 留痕）。出现其它文件即违规，回改。

- [ ] **Step 2: D2 依赖核查（spec §5.4）**

```bash
grep -n "dependencies" -A6 packages/dashboard/package.json
```

Expected: `@nx-mk/coverage`、`better-sqlite3`、`fastify` 三项不变，零新增。

- [ ] **Step 3: 全仓验证**

```bash
PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run
PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH corepack pnpm -r build
```

Expected: 全绿（预计 502 → ~555±15）；全包构建通过（含 demo app vite build）。

- [ ] **Step 4: README 验收段**

`README.md` 的 demo/使用说明区追加（位置：现有 Phase 2/3 使用说明之后）：

```markdown
## Phase 4.5：Dashboard 可操作化（手动验收）

```bash
# 0. 全量构建（含 @nx-mk/agent —— 不构建则 CLI loop 测试/运行缺依赖）
corepack pnpm install --frozen-lockfile && corepack pnpm -r build

# 1. 起分析 + Dashboard（demo 目录内）
npx nx-mk start

# 2. 浏览器验收清单：
#    a. 请求详情页 → [Replay request]：safe GET 直接复刻 + .nx-mk/replays/<runId>/ 留痕；
#    b. 构造 POST trace → 无 confirm 409 → Confirm replay 后成功（留痕 verdict=unsafe）；
#    c. curl -N "http://127.0.0.1:4317/api/events" → run 进行时看到 stage:start/stage:done/agent:iteration；
#    d. #/runs/<runId>/manifest → endpoints 表 + schema 字段表 + policy 徽章；
#    e. #/settings/plugins → 内置插件卡片 + Copy YAML。
```
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: Phase 4.5 demo 手动验收步骤 + 铁律/依赖核查记录"
```

---

## 任务依赖与并行性（SDD 控制器用）

| 任务 | 依赖 | 共享文件冲突 |
|---|---|---|
| T1 kernel 落盘 | 无 | 无 |
| T2 CLI 快照 | 无（T5 路由消费其产物，但接口已定可并行） | 无 |
| T3 replay | 无 | `server/index.ts`、`shared/api-types.ts` |
| T4 SSE | 无 | `server/index.ts` |
| T5 plugins/manifest 路由 | T1/T2 的**文件形状**（形状已在计划固定，代码可不依赖） | `server/index.ts`、`shared/api-types.ts` |
| T6 UI replay+live | T3、T4 的路由与类型（同上，接口已定） | `__tests__/ui-phase45.test.ts` |
| T7 UI 页面 | T5（同上） | `__tests__/ui-phase45.test.ts` |
| T8 收尾 | 全部 | README |

裁定建议：T3→T4→T5 串行（同改 index.ts/api-types）；T1、T2 可与 T3 并行；T6、T7 串行（同改 ui-phase45.test.ts）；T8 收尾。

## 自检（计划完成时已跑）

- Spec 覆盖：U1 全四块 → T3-T7；R1-R5 → T3；R6-R8 → T5/T7；R9-R11 → T4/T6；E1-E3 → T3；E4-E5 → T5/T7；E6-E7 → T4；E8 → T5；§5 四项验收 → T8 + 全程绿屏
- V1-V5 现实裁定已内嵌到对应任务（实现者不会撞 spec 失效前提）
- 类型一致性：ReplayResponse/PluginsResponse/ManifestResponse/TailEvent 定义与消费方（T6/T7 UI）字段逐一核对
- 占位符扫描：T2 Step 1 的 `<同既有...setup>` 是**指向同文件既有真实代码的引用指令**（该文件确有两种场景的完整用例可克隆），非 TBD
