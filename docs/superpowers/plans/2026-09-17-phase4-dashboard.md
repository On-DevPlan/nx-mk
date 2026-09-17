# Phase 4 Dashboard 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付纯只读 Dashboard（server + UI）、`nx-mk start` 一键命令、DDL 校对——让 Phase 3 的 coverage 数据可视可查。

**Architecture:** 单包 `packages/dashboard` 双构建目标（tsup 出 server 到 dist/，vite 出 UI 到 dist-ui/）；server 全程只读 `.nx-mk/` 三来源（目录扫描 / better-sqlite3 readonly / coverage-report.json），fastify 手写静态托管 + 7 条 GET 路由；UI 为 React + 手写 hash router + Poller 轮询（5s）。`nx-mk start` listen 先行 + 同进程自动 run，run 失败保活。

**Tech Stack:** fastify ^5、better-sqlite3 ^11.10（已在栈）、react ^19 + vite ^6（构建期）、vitest（既有）、TypeScript 5.3。

**Spec:** `docs/superpowers/specs/2026-09-17-nx-mk-phase4-dashboard-design.md`（本计划从中论证；执行者两份都读）

## Global Constraints

- Node ≥ 20（engines 既有）；实测环境 Node 22.23.2 / Windows + Git Bash
- pnpm **只能** 经 `corepack pnpm` 调用；根全量测试 `npx vitest run`；单包 `corepack pnpm --filter <pkg> test`
- **hermetic 不变**：测试不占真实端口（listen 全走注入缝，路由用 fastify `inject()`）、不起真浏览器、不碰网络
- 新增依赖仅五项 sanctioned（fastify/react/react-dom/vite/@vitejs/plugin-react + 类型包）；better-sqlite3 只是 dashboard 包新增直声明（Phase 2 已在栈）；**除此之外零新增**
- 文件 ≤400 行；中文注释；UI 文案英文；UI 相对导入**无后缀**（vite 不做 .js→.tsx 改写）、server 源码相对导入带 `.js`（仓库惯例）
- dashboard 测试文件**平铺**在 `packages/dashboard/src/__tests__/*.test.ts`（根 vitest.config.ts 的 include 模式 `packages/*/src/__tests__/*.test.ts` 约束）；cli 测试在 `packages/cli/src/__tests__/`
- git commit **无任何 attribution 行**（用户既定 remit）；commit 风格沿用仓库 conventional commits + 中文描述
- 根 vitest include 不含 `packages/dashboard` 专项阈值——无需动 vitest.config.ts
- 实现器契约：不派子代理；报告写到指定路径；每个任务以独立 commit 结尾

---

### Task 0: DDL 校对（Task 0，先对账后写码）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-nx-mk-phase4-dashboard-design.md`（追加附注 A）
- （仅当发现漂移）Modify: `packages/coverage/src/db/schema.ts`

**Interfaces:**
- Consumes: plan 原文 §25.1-25.9（`docx/plan/nx-mk-plan.md`，§25.1 起于 1695 行附近、§25.9 止于 1859 行附近；行号漂移时以 `grep -n "^### 25\." docx/plan/nx-mk-plan.md` 定位）；`packages/coverage/src/db/schema.ts` 的 `SCHEMA_SQL` 九表 + `ensureColumn` 两处调用
- Produces: spec 文件内 `## 附注 A：DDL 校对结论（Phase 4 Task 0）` 一节——九表逐表结论 + 两处 ALTER 一致性确认

- [ ] **Step 1: 逐字比对**

  读 plan §25.1-25.9 原文与 `SCHEMA_SQL` 九表，逐表逐列核对：列名、类型（TEXT/INTEGER/REAL/PRIMARY KEY/NOT NULL）、列序。已知的有意偏离两处（Phase 2 Task 3 pre-flight ruling 最小列集）：`endpoints`、`manifest_fields`——核对它们确实只在列集上收窄且 ruling 已在 schema.ts 头注释引用。

- [ ] **Step 2: 核对两处 ALTER**

  确认 `runs.terminated_by TEXT`、`ui_evidence.text_sample TEXT`：plan §25.1/§25.7 冻结表**不含**这两列 → ensureColumn 加列是纯增量扩展、与冻结 DDL 不冲突（老库 ALTER、新库 CREATE 后 ALTER 幂等跳过）。把该结论写明。

- [ ] **Step 3: 落档**

  在 spec 末尾追加（格式）：

  ```markdown
  ## 附注 A：DDL 校对结论（Phase 4 Task 0）

  | 表 | §25 原文 | SCHEMA_SQL | 结论 |
  |---|---|---|---|
  | runs (§25.1) | <列清单> | <一致/漂移列> | 一致（+ terminated_by 为 ensureColumn 增量） |
  | … 九表逐行 … |
  | ui_evidence (§25.7) | … | … | 一致（+ text_sample 为 ensureColumn 增量） |

  ALTER 一致性：runs.terminated_by TEXT / ui_evidence.text_sample TEXT 均为冻结 DDL 之外的纯增量列，
  与 §25 不冲突；老库经 ALTER、新库 CREATE 后 ensureColumn 幂等跳过。
  ```

  发现漂移时：先修 `SCHEMA_SQL`（注意 IF NOT EXISTS 只影响新库，老库由 ensureColumn/既有表兜底——漂移列若已存在于老库则只在附注记录、不改 DDL），再落档。

- [ ] **Step 4: 验证 + 提交**

  Run: `npx vitest run packages/coverage` （schema 改动时必须绿；未改则跑一次确认无副作用）

  ```bash
  git add docs/superpowers/specs/2026-09-17-nx-mk-phase4-dashboard-design.md packages/coverage/src/db/schema.ts
  git commit -m "docs(spec): DDL 校对结论附注（Phase 4 Task 0）"
  ```

---

### Task 1: dashboard 包脚手架 + API 类型契约 + buildServer 骨架 + 静态托管

**Files:**
- Create: `packages/dashboard/package.json`
- Create: `packages/dashboard/tsconfig.json`
- Create: `packages/dashboard/tsup.config.ts`
- Create: `packages/dashboard/vite.config.ts`
- Create: `packages/dashboard/index.html`
- Create: `packages/dashboard/src/shared/api-types.ts`
- Create: `packages/dashboard/src/server/types.ts`
- Create: `packages/dashboard/src/server/index.ts`
- Create: `packages/dashboard/src/server/static.ts`
- Create: `packages/dashboard/src/server/ui-dir.ts`
- Create: `packages/dashboard/src/__tests__/static.test.ts`

**Interfaces:**
- Consumes: 无（首包任务）
- Produces:
  - `buildServer(opts: BuildServerOptions): FastifyInstance`，`BuildServerOptions = { nxMkDir: string; uiDistDir: string; busyTimeoutMs?: number }`（`@nx-mk/dashboard` 主导出）
  - `resolveUiDistDir(): string`（`@nx-mk/dashboard` 主导出；Task 6 的 start 命令消费）
  - `registerStatic(app: FastifyInstance, uiDistDir: string): void`
  - `RouteContext = { nxMkDir: string; busyTimeoutMs?: number }`（Task 4 路由消费）
  - `src/shared/api-types.ts` 全部类型（Task 3/4/7/8 消费，定义见下方代码——后续任务原样引用不再重复）

- [ ] **Step 1: 写包骨架（先不装依赖，文件就位后再装）**

  `packages/dashboard/package.json`：

  ```json
  {
    "name": "@nx-mk/dashboard",
    "version": "0.1.0",
    "private": true,
    "description": "nx-mk local dashboard — read-only coverage console (server + UI)",
    "type": "module",
    "main": "./dist/server/index.js",
    "types": "./dist/server/index.d.ts",
    "exports": {
      ".": {
        "types": "./dist/server/index.d.ts",
        "import": "./dist/server/index.js"
      }
    },
    "files": ["dist", "dist-ui"],
    "scripts": {
      "build": "tsup",
      "typecheck": "tsc --noEmit",
      "test": "vitest run",
      "clean": "rm -rf dist dist-ui .turbo *.tsbuildinfo"
    },
    "dependencies": {
      "@nx-mk/coverage": "workspace:*",
      "better-sqlite3": "^11.10.0",
      "fastify": "^5.2.0"
    },
    "devDependencies": {
      "@types/better-sqlite3": "^7.6.13",
      "@types/node": "^20.10.0",
      "@types/react": "^19.1.0",
      "@types/react-dom": "^19.1.0",
      "@vitejs/plugin-react": "^4.4.0",
      "react": "^19.1.0",
      "react-dom": "^19.1.0",
      "tsup": "^8.0.2",
      "typescript": "^5.3.3",
      "vite": "^6.3.0",
      "vitest": "^1.0.4"
    }
  }
  ```

  注意：`build` 本任务只出 server（tsup）；Task 8 会扩为 `tsup && vite build`（届时 UI 源码才存在）。

  `packages/dashboard/tsconfig.json`：

  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "jsx": "react-jsx",
      "types": ["node"]
    },
    "include": ["src", "vite.config.ts", "tsup.config.ts"]
  }
  ```

  `packages/dashboard/tsup.config.ts`：

  ```ts
  import { defineConfig } from 'tsup'

  export default defineConfig({
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
    external: ['better-sqlite3', 'fastify', '@nx-mk/coverage'],
  })
  ```

  `packages/dashboard/vite.config.ts`（Task 8 才真正可构建，先就位）：

  ```ts
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  // UI 构建流：root=包根（index.html 在包根），产物到 dist-ui/，base './' 便于任意挂载路径
  export default defineConfig({
    plugins: [react()],
    base: './',
    build: { outDir: 'dist-ui', emptyOutDir: true },
  })
  ```

  `packages/dashboard/index.html`：

  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>nx-mk dashboard</title>
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/ui/main.tsx"></script>
    </body>
  </html>
  ```

- [ ] **Step 2: 写 shared/api-types.ts（API 契约单一事实来源）**

  `packages/dashboard/src/shared/api-types.ts`：

  ```ts
  /**
   * API 响应形状 —— server 路由与 UI 页面共享（spec §3.5）。
   * db 行投影类型 = §25 对应表列的 camelCase 直译，不臆造字段。
   */
  import type {
    CoverageReportMetrics,
    FieldCoverageItem,
    RequestTraceSummary,
  } from '@nx-mk/coverage'

  /** §25.1 runs 行投影（含 Phase 3 ensureColumn 增量列 terminated_by） */
  export interface RunRow {
    id: string
    startedAt: string | null
    endedAt: string | null
    status: string
    projectName: string | null
    dashboardUrl: string | null
    manifestHash: string | null
    configPath: string | null
    resolvedConfigPath: string | null
    terminatedBy: string | null
  }

  /** §25.4 request_traces 行投影 */
  export interface TraceRow {
    id: string
    runId: string
    traceId: string
    scenarioId: string | null
    dslStepId: string | null
    endpointId: string | null
    method: string
    url: string
    path: string | null
    status: number | null
    durationMs: number | null
    startedAt: string | null
    endedAt: string | null
    replayable: number | null
    replaySafety: string | null
    replayReason: string | null
  }

  /** §25.6 field_hits 行投影 */
  export interface FieldHitRow {
    id: string
    runId: string
    requestId: string | null
    endpointId: string | null
    fieldId: string | null
    fieldPath: string
    normalizedPath: string
    count: number
    firstHitAt: string | null
    lastHitAt: string | null
    route: string | null
    source: string | null
  }

  /** §25.7 ui_evidence 行投影（含 Phase 3 增量列 text_sample） */
  export interface UiEvidenceRow {
    id: string
    runId: string
    requestId: string | null
    fieldId: string | null
    fieldPath: string
    evidenceType: string | null
    selector: string | null
    visible: number | null
    inViewport: number | null
    route: string | null
    screenshotPath: string | null
    textSample: string | null
  }

  /** §25.8 coverage_fields 行投影 */
  export interface CoverageFieldRow {
    id: string
    runId: string
    fieldId: string
    endpointId: string | null
    fieldPath: string
    policyStatus: string
    coverageState: string
    accessHit: number | null
    uiHit: number | null
    assertionHit: number | null
    suspicious: number | null
    countedRequired: number | null
    countedEffective: number | null
  }

  /** /api/runs 列表项：目录扫描为主键来源，db 行可选富化（可选键缺省即不出现） */
  export interface RunListItem {
    runId: string
    hasEvents: boolean
    hasReport: boolean
    status?: string
    startedAt?: string
    endedAt?: string
    terminatedBy?: string
  }

  export interface RunsListResponse {
    runs: RunListItem[]
    /** manifest.json 是 workspace 级产物（不随 run），在顶层报告（spec §3.5 修订） */
    manifestAvailable: boolean
  }

  export interface RunDetailResponse extends RunListItem {
    dbRow: RunRow | null
  }

  export interface MetricsResponse {
    runId: string
    status?: string
    terminatedBy?: string
    metrics: CoverageReportMetrics
  }

  export interface RequestsListResponse {
    requests: RequestTraceSummary[]
  }

  export interface RequestDetailResponse {
    trace: TraceRow
    hits: FieldHitRow[]
    evidence: UiEvidenceRow[]
  }

  /** db 行为基座 + report 富化（hitCount/matchedRule 不在 §25.8 列中，spec §3.5） */
  export type EnrichedCoverageFieldRow = CoverageFieldRow & {
    hitCount?: number
    matchedRule?: FieldCoverageItem['matchedRule']
  }

  export interface FieldsListResponse {
    fields: EnrichedCoverageFieldRow[]
  }

  export interface IgnoredListResponse {
    ignored: FieldCoverageItem[]
  }

  /** 错误响应（404/503） */
  export interface ApiErrorResponse {
    error: string
    hint?: string
  }
  ```

- [ ] **Step 3: 写 server 骨架三文件**

  `packages/dashboard/src/server/types.ts`：

  ```ts
  /** 路由上下文：路由模块只依赖这个窄接口（Task 4 的 register*Routes 消费） */
  export interface RouteContext {
    /** .nx-mk 目录（绝对或相对 cwd）——server 全程只读 */
    nxMkDir: string
    /** SQLite busy_timeout（测试注入小值加速 503 用例）；缺省 2000ms */
    busyTimeoutMs?: number
  }
  ```

  `packages/dashboard/src/server/ui-dir.ts`：

  ```ts
  /**
   * UI 产物目录定位：dist/server/*.js → 包根/dist-ui（vite build 产物，Task 8 生成）。
   * CLI 的 start 命令经主导出消费，避免在 cli 侧拼接跨包相对路径。
   */
  import { fileURLToPath } from 'node:url'
  import { join } from 'node:path'

  export function resolveUiDistDir(): string {
    const here = fileURLToPath(import.meta.url) // …/packages/dashboard/dist/server/index.js
    const pkgRoot = join(here, '..', '..', '..')
    return join(pkgRoot, 'dist-ui')
  }
  ```

  `packages/dashboard/src/server/static.ts`：

  ```ts
  /**
   * 静态托管（spec §3.3）：GET / → index.html；GET /assets/:name → dist-ui/assets/ 下文件。
   * hash 路由使页面路径全部位于 #/ 之后，server 永远只见 /，无需 SPA fallback。
   * 路径安全（spec §4）：:name 不跨段（find-my-way 语义）+ decodeURIComponent 后
   * resolve 强制落在 assets root 内；穿越矩阵用例测试锁定。
   */
  import { readFile } from 'node:fs/promises'
  import { existsSync, statSync } from 'node:fs'
  import { join, resolve, sep } from 'node:path'
  import type { FastifyInstance } from 'fastify'

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
  }

  export function registerStatic(app: FastifyInstance, uiDistDir: string): void {
    const root = resolve(uiDistDir)
    const assetsRoot = join(root, 'assets')

    app.get('/', async (_req, reply) => {
      try {
        const html = await readFile(join(root, 'index.html'))
        return reply.type('text/html; charset=utf-8').send(html)
      } catch {
        return reply.code(404).send({
          error: 'dashboard UI not built',
          hint: 'run: corepack pnpm --filter @nx-mk/dashboard build',
        })
      }
    })

    app.get('/assets/:name', async (req, reply) => {
      const { name } = req.params as { name: string }
      let decoded: string
      try {
        decoded = decodeURIComponent(name)
      } catch {
        return reply.code(404).send()
      }
      // 归一化后强制在 assets root 内（../、绝对路径、编码变体一律 404）
      const abs = resolve(assetsRoot, decoded)
      if (!abs.startsWith(assetsRoot + sep)) return reply.code(404).send()
      if (!existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send()
      const dot = abs.lastIndexOf('.')
      const type = dot === -1 ? 'application/octet-stream' : MIME[abs.slice(dot)] ?? 'application/octet-stream'
      const body = await readFile(abs)
      return reply.type(type).send(body)
    })
  }
  ```

  `packages/dashboard/src/server/index.ts`：

  ```ts
  /**
   * buildServer —— Dashboard server 工厂（spec §3.2）。
   * 本任务只有静态托管；Task 4 在此追加 7 条 /api 路由注册。
   * logger 关闭：本地分析台，stdout 由 start 命令管理。
   */
  import Fastify, { type FastifyInstance } from 'fastify'
  import { registerStatic } from './static.js'

  export interface BuildServerOptions {
    /** .nx-mk 目录（绝对或相对 cwd） */
    nxMkDir: string
    /** UI 产物目录（index.html 所在） */
    uiDistDir: string
    /** SQLite busy_timeout 覆盖（测试注入小值）；缺省 2000ms */
    busyTimeoutMs?: number
  }

  export function buildServer(opts: BuildServerOptions): FastifyInstance {
    const app = Fastify({ logger: false })
    registerStatic(app, opts.uiDistDir)
    return app
  }
  ```

- [ ] **Step 4: 写失败测试（静态托管）**

  `packages/dashboard/src/__tests__/static.test.ts`：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  import { buildServer } from '../server/index.js'

  let dir: string
  let uiDist: string
  let nxMk: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-dash-t1-'))
    uiDist = join(dir, 'ui')
    nxMk = join(dir, '.nx-mk')
    mkdirSync(join(uiDist, 'assets'), { recursive: true })
    mkdirSync(nxMk, { recursive: true })
    writeFileSync(join(uiDist, 'index.html'), '<html>nx-mk</html>')
    writeFileSync(join(uiDist, 'assets', 'app.js'), 'console.log(1)')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  describe('static hosting', () => {
    it('GET / serves index.html as html', async () => {
      const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('<html>nx-mk</html>')
      expect(res.headers['content-type']).toContain('text/html')
      await app.close()
    })

    it('GET /assets/:name serves js with content-type', async () => {
      const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
      const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('console.log(1)')
      expect(res.headers['content-type']).toContain('text/javascript')
      await app.close()
    })

    it.each([
      '/assets/..%2Findex.html',   // 编码 ../ 逃逸（fastify/手写两层 decode 均可达）
      '/assets/%2e%2e%2fapp.js',   // 编码变体
      '/assets/missing.js',        // 不存在
    ])('traversal/missing → 404: %s', async (url) => {
      const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('UI not built → GET / gives actionable 404', async () => {
      const app = buildServer({ nxMkDir: nxMk, uiDistDir: join(dir, 'no-such-ui') })
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(404)
      expect(res.json().hint).toContain('pnpm --filter @nx-mk/dashboard build')
      await app.close()
    })

    it('unknown /api path → 404', async () => {
      const app = buildServer({ nxMkDir: nxMk, uiDistDir: uiDist })
      const res = await app.inject({ method: 'GET', url: '/api/nope' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })
  ```

- [ ] **Step 5: 装依赖并验证**

  Run: `corepack pnpm install`（workspace 锁文件更新；若 registry 超时属网络环境问题，报告状态 BLOCKED 而不是改 .npmrc）

  Run: `corepack pnpm --filter @nx-mk/dashboard test` → PASS（5 用例）
  Run: `corepack pnpm --filter @nx-mk/dashboard typecheck` → 绿
  Run: `npx vitest run packages/dashboard` → PASS（根 vitest include 命中平铺布局）

- [ ] **Step 6: 提交**

  ```bash
  git add packages/dashboard pnpm-lock.yaml
  git commit -m "feat(dashboard): 包脚手架 + 静态托管 + API 类型契约"
  ```

---

### Task 2: 文件 store —— runs 目录扫描 + coverage-report 形状门控

**Files:**
- Create: `packages/dashboard/src/server/store/runs-store.ts`
- Create: `packages/dashboard/src/server/store/report-reader.ts`
- Create: `packages/dashboard/src/__tests__/fixtures.ts`
- Create: `packages/dashboard/src/__tests__/runs-store.test.ts`
- Create: `packages/dashboard/src/__tests__/report-reader.test.ts`

**Interfaces:**
- Consumes: `@nx-mk/coverage` 的 `type CoverageReport`（dist 导出，既有）
- Produces:
  - `listRuns(nxMkDir: string): { runId: string; hasEvents: boolean }[]`（runId 升序；`.nx-mk/runs` 缺失 → `[]`）
  - `readCoverageReport(nxMkDir: string): CoverageReport | null`（缺失/解析失败/形状非法 → null；四数组 + endpoints + requests 缺省补 `[]`）
  - `reportForRun(nxMkDir: string, runId: string): CoverageReport | null`（runId 匹配门控——report 是最新 run 的覆盖写产物，spec D12）
  - 测试夹具 `fixtures.ts`（本任务建文件级三函数；Task 3 追加 `seedDb`）

- [ ] **Step 1: 写测试夹具文件级函数**

  `packages/dashboard/src/__tests__/fixtures.ts`：

  ```ts
  /**
   * Dashboard 测试夹具（hermetic）：tmp 目录搭 .nx-mk 形状。
   * 文件级函数在本文件（Task 2）；db 播种 seedDb 由 Task 3 追加。
   */
  import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  import type { CoverageReport } from '@nx-mk/coverage'

  /** 建 .nx-mk + runs 子目录；withEvents 的 run 写空 events.jsonl */
  export function makeNxMkDir(runs: { runId: string; withEvents?: boolean }[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'nx-mk-dash-'))
    const nx = join(dir, '.nx-mk')
    mkdirSync(nx, { recursive: true })
    for (const r of runs) {
      mkdirSync(join(nx, 'runs', r.runId), { recursive: true })
      if (r.withEvents) writeFileSync(join(nx, 'runs', r.runId, 'events.jsonl'), '')
    }
    return dir
  }

  /** demo 语义的报告 fixture（对齐 Phase 3 实测口径：required 100% / raw ~36%） */
  export function reportFixture(runId: string, overrides: Partial<CoverageReport> = {}): CoverageReport {
    return {
      runId,
      metrics: {
        requiredCoverage: 1,
        effectiveCoverage: 1,
        rawBackendFieldCoverage: 0.36,
        endpointsTotal: 1,
        endpointsCalled: 1,
        fieldsTotal: 8,
        fieldsReturned: 8,
        requiredFields: 7,
        missingRequiredFields: 0,
        ignoredReturnedFields: 1,
        suspiciousFields: 0,
      },
      missingRequiredFields: [],
      weakEvidenceFields: [],
      ignoredReturnedFields: [
        {
          fieldId: 'data.internalRiskScore',
          fieldPath: 'data.internalRiskScore',
          state: 'ignored',
          policyStatus: 'ignored',
          hitCount: 1,
          matchedRule: { source: 'user-config', pattern: 'data.internalRiskScore' },
        },
      ],
      suspiciousCoverage: [],
      endpoints: [
        { endpointId: 'ep_getUser', method: 'GET', path: '/users/{id}', called: true, fieldsTotal: 8, fieldsCovered: 7 },
      ],
      requests: [
        {
          requestId: 'req_1', endpointId: 'ep_getUser', method: 'GET',
          url: 'http://localhost:8787/users/1', path: '/users/1', status: 200, durationMs: 12,
          startedAt: '2026-09-17T10:00:01.000Z', endedAt: '2026-09-17T10:00:01.012Z',
        },
      ],
      ...overrides,
    }
  }

  export function writeReportFile(nxMkDir: string, report: CoverageReport): void {
    writeFileSync(join(nxMkDir, 'coverage-report.json'), JSON.stringify(report, null, 2))
  }
  ```

- [ ] **Step 2: 写失败测试（两个 store）**

  `packages/dashboard/src/__tests__/runs-store.test.ts`：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { writeFileSync, rmSync } from 'node:fs'
  import { join } from 'node:path'
  import { listRuns } from '../server/store/runs-store.js'
  import { makeNxMkDir } from './fixtures.js'

  let dir: string
  beforeEach(() => { dir = '' })
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  describe('listRuns', () => {
    it('lists run dirs sorted asc with events flag; ignores files', () => {
      dir = makeNxMkDir([
        { runId: 'run_20260917_100000', withEvents: true },
        { runId: 'run_20260917_100005' },
      ])
      writeFileSync(join(dir, '.nx-mk', 'runs', 'a-file.txt'), 'x') // 非目录项忽略
      expect(listRuns(dir)).toEqual([
        { runId: 'run_20260917_100000', hasEvents: true },
        { runId: 'run_20260917_100005', hasEvents: false },
      ])
    })

    it('empty .nx-mk → []', () => {
      dir = makeNxMkDir([])
      expect(listRuns(dir)).toEqual([])
    })

    it('missing .nx-mk → [] (spec §4 降级)', () => {
      expect(listRuns(join(dir, 'nope') || 'definitely-missing-path')).toEqual([])
    })
  })
  ```

  `packages/dashboard/src/__tests__/report-reader.test.ts`：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { writeFileSync, rmSync } from 'node:fs'
  import { join } from 'node:path'
  import { readCoverageReport, reportForRun } from '../server/store/report-reader.js'
  import { makeNxMkDir, reportFixture, writeReportFile } from './fixtures.js'

  let dir: string
  beforeEach(() => { dir = makeNxMkDir([]) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  describe('readCoverageReport', () => {
    it('valid report → object', () => {
      writeReportFile(dir, reportFixture('run_a'))
      expect(readCoverageReport(dir)?.runId).toBe('run_a')
    })
    it('missing file → null', () => {
      expect(readCoverageReport(dir)).toBeNull()
    })
    it('broken JSON → null', () => {
      writeFileSync(join(dir, 'coverage-report.json'), '{oops')
      expect(readCoverageReport(dir)).toBeNull()
    })
    it('shape invalid (metrics missing) → null', () => {
      writeFileSync(join(dir, 'coverage-report.json'), JSON.stringify({ runId: 'run_a' }))
      expect(readCoverageReport(dir)).toBeNull()
    })
    it('shape invalid (metric not number) → null', () => {
      const r = reportFixture('run_a')
      ;(r.metrics as unknown as { requiredCoverage: string }).requiredCoverage = '100%'
      writeReportFile(dir, r)
      expect(readCoverageReport(dir)).toBeNull()
    })
    it('missing arrays default to []', () => {
      const r = reportFixture('run_a') as unknown as Record<string, unknown>
      delete r.requests
      delete r.suspiciousCoverage
      writeFileSync(join(dir, 'coverage-report.json'), JSON.stringify(r))
      const parsed = readCoverageReport(dir)
      expect(parsed?.requests).toEqual([])
      expect(parsed?.suspiciousCoverage).toEqual([])
    })
  })

  describe('reportForRun (runId 匹配门控)', () => {
    it('matching runId → report', () => {
      writeReportFile(dir, reportFixture('run_b'))
      expect(reportForRun(dir, 'run_b')?.runId).toBe('run_b')
    })
    it('older run (mismatch) → null（report 是最新 run 的覆盖写产物，spec D12）', () => {
      writeReportFile(dir, reportFixture('run_b'))
      expect(reportForRun(dir, 'run_a')).toBeNull()
    })
    it('no report → null', () => {
      expect(reportForRun(dir, 'run_b')).toBeNull()
    })
  })
  ```

- [ ] **Step 3: 跑测试确认失败**

  Run: `corepack pnpm --filter @nx-mk/dashboard test`
  Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现**

  `packages/dashboard/src/server/store/runs-store.ts`：

  ```ts
  /**
   * runs 目录扫描（spec §3.1）：.nx-mk/runs/ 子目录即 runId 主键来源——
   * 非 collect run 没有 db 行，目录是唯一普适存在。runId 形如 run_YYYYMMDD_HHMMSS，
   * 字典序 = 时间序。任何 IO 异常按空处理（spec §4：只读降级不抛）。
   */
  import { existsSync, readdirSync, statSync } from 'node:fs'
  import { join } from 'node:path'

  export interface FileRun {
    runId: string
    hasEvents: boolean
  }

  export function listRuns(nxMkDir: string): FileRun[] {
    const runsDir = join(nxMkDir, 'runs')
    if (!existsSync(runsDir)) return []
    let entries: string[]
    try {
      entries = readdirSync(runsDir)
    } catch {
      return []
    }
    const out: FileRun[] = []
    for (const name of entries) {
      const p = join(runsDir, name)
      try {
        if (!statSync(p).isDirectory()) continue
      } catch {
        continue
      }
      out.push({ runId: name, hasEvents: existsSync(join(p, 'events.jsonl')) })
    }
    return out.sort((a, b) => a.runId.localeCompare(b.runId))
  }
  ```

  `packages/dashboard/src/server/store/report-reader.ts`：

  ```ts
  /**
   * coverage-report.json 读取（spec §3.1）：形状门控（手法同 run.ts isManifestShaped）
   * + runId 匹配门控（D12：report 是最新 run 的覆盖写产物，旧 run 查询按缺失处理）。
   */
  import { readFileSync } from 'node:fs'
  import { join } from 'node:path'
  import type { CoverageReport } from '@nx-mk/coverage'

  export function readCoverageReport(nxMkDir: string): CoverageReport | null {
    let raw: string
    try {
      raw = readFileSync(join(nxMkDir, 'coverage-report.json'), 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    return isReportShaped(parsed) ? parsed : null
  }

  function isReportShaped(v: unknown): v is CoverageReport {
    if (typeof v !== 'object' || v === null) return false
    const o = v as Record<string, unknown>
    if (typeof o.runId !== 'string') return false
    if (typeof o.metrics !== 'object' || o.metrics === null) return false
    const m = o.metrics as Record<string, unknown>
    for (const k of ['requiredCoverage', 'effectiveCoverage', 'rawBackendFieldCoverage'] as const) {
      if (typeof m[k] !== 'number') return false
    }
    // 六个数组缺省补 []（写入解析产物——所有权已归本进程）
    for (const k of [
      'missingRequiredFields', 'weakEvidenceFields', 'ignoredReturnedFields',
      'suspiciousCoverage', 'endpoints', 'requests',
    ]) {
      if (!Array.isArray(o[k])) o[k] = []
    }
    return true
  }

  /** runId 匹配门控：report.runId ≠ 查询目标 → 按缺失（spec §3.1/D12） */
  export function reportForRun(nxMkDir: string, runId: string): CoverageReport | null {
    const r = readCoverageReport(nxMkDir)
    return r !== null && r.runId === runId ? r : null
  }
  ```

- [ ] **Step 5: 跑测试确认通过**

  Run: `corepack pnpm --filter @nx-mk/dashboard test` → PASS（新增 13 用例）

- [ ] **Step 6: 提交**

  ```bash
  git add packages/dashboard/src
  git commit -m "feat(dashboard): runs 目录扫描 + coverage-report 形状门控读取"
  ```

---

### Task 3: db store —— coverage.db 只读层 + 五表查询投影

**Files:**
- Create: `packages/dashboard/src/server/store/db-reader.ts`
- Create: `packages/dashboard/src/server/store/queries.ts`
- Modify: `packages/dashboard/src/__tests__/fixtures.ts`（追加 `seedDb`）
- Create: `packages/dashboard/src/__tests__/db-reader.test.ts`
- Create: `packages/dashboard/src/__tests__/queries.test.ts`

**Interfaces:**
- Consumes: `better-sqlite3`（直声明）；`@nx-mk/coverage` 的 `openCoverageDb`（仅测试播种建表用）；Task 1 的 `RunRow/TraceRow/FieldHitRow/UiEvidenceRow/CoverageFieldRow`
- Produces:
  - `openReader(dbPath: string, opts?: { busyTimeoutMs?: number }): CoverageDbReader | null`（文件缺失/打开失败 → null；**绝不执行任何 DDL/写**）
  - `interface CoverageDbReader { all<T>(sql: string, ...params: unknown[]): T[]; get<T>(sql: string, ...params: unknown[]): T | undefined; close(): void }`
  - `class DbBusyError extends Error`；`const BUSY_TIMEOUT_MS = 2000`
  - `class Queries`，构造参数 `CoverageDbReader`，方法：
    - `getRun(runId: string): RunRow | undefined`
    - `listRuns(): RunRow[]`（started_at 升序）
    - `listTraces(runId: string): TraceRow[]`（started_at 升序）
    - `getTrace(runId: string, traceId: string): TraceRow | undefined`（按 `trace_id` 列）
    - `listHitsByRequest(runId: string, requestId: string): FieldHitRow[]`
    - `listEvidenceByRequest(runId: string, requestId: string): UiEvidenceRow[]`
    - `listCoverageFields(runId: string): CoverageFieldRow[]`（field_path 升序）
  - `seedDb(nxMkDir: string, seed: DbSeed): void`（测试夹具；直接 SQL 播种，列级精确控制）

- [ ] **Step 1: 追加 fixtures.seedDb**

  在 `packages/dashboard/src/__tests__/fixtures.ts` 末尾追加：

  ```ts
  import { openCoverageDb } from '@nx-mk/coverage'

  /** db 播种形状：全部可选，按需给行 */
  export interface DbSeed {
    dbFileName?: string                       // 默认 coverage.db（测试可另建库名）
    runs?: { id: string; status?: string; terminatedBy?: string | null; startedAt?: string; endedAt?: string | null }[]
    traces?: { runId: string; traceId: string; method?: string; url?: string; path?: string | null; status?: number | null; durationMs?: number | null; startedAt?: string | null }[]
    hits?: { runId: string; requestId?: string | null; fieldPath: string; normalizedPath?: string; count?: number }[]
    evidence?: { runId: string; requestId?: string | null; fieldPath: string; visible?: boolean; textSample?: string | null }[]
    coverageFields?: { runId: string; fieldId?: string; fieldPath: string; policyStatus?: string; coverageState?: string; accessHit?: number; uiHit?: number }[]
  }

  /**
   * 直接 SQL 播种（绕开 Core 类型，列级精确控制）；
   * openCoverageDb 只用来建表 + ensureColumn 加列，随后立刻用裸 prepare 插行。
   */
  export function seedDb(nxMkDir: string, seed: DbSeed): string {
    const dbPath = join(nxMkDir, seed.dbFileName ?? 'coverage.db')
    const db = openCoverageDb(dbPath)
    try {
      for (const r of seed.runs ?? []) {
        db.prepare('INSERT OR REPLACE INTO runs (id, started_at, ended_at, status, terminated_by) VALUES (?, ?, ?, ?, ?)')
          .run(r.id, r.startedAt ?? '2026-09-17T10:00:00.000Z', r.endedAt ?? null, r.status ?? 'completed', r.terminatedBy ?? null)
      }
      for (const t of seed.traces ?? []) {
        db.prepare(
          'INSERT OR REPLACE INTO request_traces (id, run_id, trace_id, scenario_id, dsl_step_id, endpoint_id, method, url, path, status, duration_ms, started_at, ended_at, replayable, replay_safety, replay_reason) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)',
        ).run(
          `rt_${t.runId}_${t.traceId}`, t.runId, t.traceId,
          t.method ?? 'GET', t.url ?? `http://local/${t.traceId}`, t.path ?? null,
          t.status ?? 200, t.durationMs ?? null, t.startedAt ?? null, t.startedAt ?? null,
        )
      }
      for (const h of seed.hits ?? []) {
        db.prepare(
          "INSERT OR REPLACE INTO field_hits (id, run_id, request_id, endpoint_id, field_id, field_path, normalized_path, count, first_hit_at, last_hit_at, route, source) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, NULL, 'proxy')",
        ).run(
          `fh_${h.runId}_${h.fieldPath}`, h.runId, h.requestId ?? null,
          h.fieldPath, h.normalizedPath ?? h.fieldPath, h.count ?? 1,
        )
      }
      for (const e of seed.evidence ?? []) {
        db.prepare(
          "INSERT OR REPLACE INTO ui_evidence (id, run_id, request_id, field_id, field_path, evidence_type, selector, visible, in_viewport, route, screenshot_path, text_sample) VALUES (?, ?, ?, NULL, ?, 'text', NULL, ?, 1, NULL, NULL, ?)",
        ).run(
          `ue_${h0(e.runId, e.fieldPath)}`, e.runId, e.requestId ?? null,
          e.fieldPath, e.visible === false ? 0 : 1, e.textSample ?? null,
        )
      }
      for (const c of seed.coverageFields ?? []) {
        db.prepare(
          'INSERT OR REPLACE INTO coverage_fields (id, run_id, field_id, endpoint_id, field_path, policy_status, coverage_state, access_hit, ui_hit, assertion_hit, suspicious, counted_required, counted_effective) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, ?)',
        ).run(
          `cf_${c.runId}_${c.fieldPath}`, c.runId, c.fieldId ?? c.fieldPath, c.fieldPath,
          c.policyStatus ?? 'required', c.coverageState ?? 'covered',
          c.accessHit ?? 1, c.uiHit ?? 0, c.accessHit ?? 1, c.uiHit ?? 0,
        )
      }
    } finally {
      db.close()
    }
    return dbPath
  }

  // 命名辅助：fieldPath 含点号直接用于 id（仅 fixture 内保证唯一即可）
  function h0(runId: string, fieldPath: string): string {
    return `${runId}_${fieldPath}`
  }
  ```

  注意：evidence 循环里第一处 `ue_${h0(...)}` 引用了辅助函数；`import { openCoverageDb } from '@nx-mk/coverage'` 放到文件顶部 import 区（不要留在文件中段）。

- [ ] **Step 2: 写失败测试**

  `packages/dashboard/src/__tests__/db-reader.test.ts`：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import Database from 'better-sqlite3'
  import { writeFileSync, rmSync } from 'node:fs'
  import { join } from 'node:path'
  import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../server/store/db-reader.js'
  import { makeNxMkDir, seedDb } from './fixtures.js'

  let dir: string
  beforeEach(() => { dir = makeNxMkDir([]) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  describe('openReader', () => {
    it('opens existing db and reads', () => {
      seedDb(dir, { runs: [{ id: 'run_a', status: 'completed' }] })
      const reader = openReader(join(dir, 'coverage.db'))
      expect(reader).not.toBeNull()
      expect(reader!.get<unknown>('SELECT * FROM runs WHERE id = ?', 'run_a')).toBeDefined()
      reader!.close()
    })
    it('missing file → null (spec §4 降级)', () => {
      expect(openReader(join(dir, 'coverage.db'))).toBeNull()
    })
    it('non-sqlite file → null (打开失败不抛)', () => {
      writeFileSync(join(dir, 'coverage.db'), 'not a database at all')
      expect(openReader(join(dir, 'coverage.db'))).toBeNull()
    })
    it('reader never writes: WAL mode is the writer-side concern', () => {
      // 只读连接只暴露 all/get/close —— 由类型面保证；此处验证 busy_timeout 注入生效路径
      seedDb(dir, { runs: [{ id: 'run_a' }] })
      const reader = openReader(join(dir, 'coverage.db'), { busyTimeoutMs: 50 })
      expect(reader).not.toBeNull()
      reader!.close()
    })
    it('BUSY_TIMEOUT_MS default is 2000', () => {
      expect(BUSY_TIMEOUT_MS).toBe(2000)
    })
  })

  describe('busy → DbBusyError', () => {
    it('write lock held → reader query throws DbBusyError', () => {
      seedDb(dir, { runs: [{ id: 'run_a' }] })
      // 模拟写入方持锁：独立连接 BEGIN EXCLUSIVE
      const writer = new Database(join(dir, 'coverage.db'))
      writer.pragma('journal_mode = WAL')
      writer.exec('BEGIN EXCLUSIVE')
      try {
        const reader = openReader(join(dir, 'coverage.db'), { busyTimeoutMs: 50 })
        expect(() => reader!.get('SELECT * FROM runs')).toThrow(DbBusyError)
        reader!.close()
      } finally {
        writer.exec('ROLLBACK')
        writer.close()
      }
    })
  })
  ```

  `packages/dashboard/src/__tests__/queries.test.ts`：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { rmSync } from 'node:fs'
  import { join } from 'node:path'
  import { openReader } from '../server/store/db-reader.js'
  import { Queries } from '../server/store/queries.js'
  import { makeNxMkDir, seedDb } from './fixtures.js'

  let dir: string
  beforeEach(() => {
    dir = makeNxMkDir([])
    seedDb(dir, {
      runs: [
        { id: 'run_a', status: 'failed', startedAt: '2026-09-17T09:00:00.000Z' },
        { id: 'run_b', status: 'completed', terminatedBy: 'goal-met', startedAt: '2026-09-17T10:00:00.000Z', endedAt: '2026-09-17T10:00:05.000Z' },
      ],
      traces: [
        { runId: 'run_b', traceId: 'req_1', method: 'GET', url: 'http://local/1', path: '/users/1', status: 200, durationMs: 12, startedAt: '2026-09-17T10:00:01.000Z' },
        { runId: 'run_b', traceId: 'req_2', method: 'POST', url: 'http://local/2', path: '/users', status: 201, durationMs: 30, startedAt: '2026-09-17T10:00:02.000Z' },
      ],
      hits: [
        { runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', count: 3 },
        { runId: 'run_b', requestId: null, fieldPath: 'data.email', count: 1 },
      ],
      evidence: [
        { runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', textSample: 'Ada' },
        { runId: 'run_b', requestId: null, fieldPath: 'data.email', textSample: null },
      ],
      coverageFields: [
        { runId: 'run_b', fieldPath: 'data.id', policyStatus: 'required', coverageState: 'covered', accessHit: 1, uiHit: 1 },
        { runId: 'run_b', fieldPath: 'data.internalRiskScore', policyStatus: 'ignored', coverageState: 'ignored', accessHit: 1, uiHit: 0 },
      ],
    })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function q(): Queries {
    const reader = openReader(join(dir, 'coverage.db'))
    expect(reader).not.toBeNull()
    return new Queries(reader!)
  }

  describe('Queries', () => {
    it('getRun found → RunRow camelCase + terminatedBy', () => {
      const row = q().getRun('run_b')
      expect(row).toMatchObject({
        id: 'run_b', status: 'completed', terminatedBy: 'goal-met',
        startedAt: '2026-09-17T10:00:00.000Z', endedAt: '2026-09-17T10:00:05.000Z',
        projectName: null, manifestHash: null,
      })
    })
    it('getRun unknown → undefined', () => {
      expect(q().getRun('run_x')).toBeUndefined()
    })
    it('listRuns ordered by started_at asc', () => {
      expect(q().listRuns().map((r) => r.id)).toEqual(['run_a', 'run_b'])
    })
    it('listTraces projects §25.4 columns', () => {
      const traces = q().listTraces('run_b')
      expect(traces).toHaveLength(2)
      expect(traces[0]).toMatchObject({ traceId: 'req_1', method: 'GET', status: 200, durationMs: 12, scenarioId: null })
    })
    it('getTrace by trace_id', () => {
      expect(q().getTrace('run_b', 'req_2')?.method).toBe('POST')
      expect(q().getTrace('run_b', 'req_9')).toBeUndefined()
    })
    it('listHitsByRequest filters by request_id (unlinked excluded)', () => {
      const hits = q().listHitsByRequest('run_b', 'req_1')
      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatchObject({ fieldPath: 'data.name', count: 3, requestId: 'req_1' })
    })
    it('listEvidenceByRequest + textSample 投影', () => {
      const ev = q().listEvidenceByRequest('run_b', 'req_1')
      expect(ev).toHaveLength(1)
      expect(ev[0]).toMatchObject({ fieldPath: 'data.name', textSample: 'Ada', visible: 1 })
    })
    it('listCoverageFields 13 列投影', () => {
      const fields = q().listCoverageFields('run_b')
      expect(fields).toHaveLength(2)
      expect(fields[0]).toMatchObject({
        fieldPath: 'data.id', policyStatus: 'required', coverageState: 'covered',
        accessHit: 1, uiHit: 1, assertionHit: 0, suspicious: 0,
        countedRequired: 1, countedEffective: 1,
      })
    })
    it('run 隔离：run_a 查不到 run_b 的行', () => {
      expect(q().listTraces('run_a')).toEqual([])
      expect(q().listCoverageFields('run_a')).toEqual([])
    })
  })
  ```

- [ ] **Step 3: 跑测试确认失败**

  Run: `corepack pnpm --filter @nx-mk/dashboard test` → 新增两文件 FAIL（模块不存在），Task 2 用例仍 PASS

- [ ] **Step 4: 实现 db-reader.ts**

  ```ts
  /**
   * coverage.db 只读连接（spec §3.1）：绝不做任何 DDL/写操作——
   * 不复用 CoverageDb（其构造即建表 + ensureColumn ALTER，写语义）。
   * WAL（Phase 2 既有）下与写入方并发安全；busy 超时映射 DbBusyError（路由层 → 503）。
   */
  import { existsSync } from 'node:fs'
  import Database from 'better-sqlite3'
  import type { Statement as SqliteStatement } from 'better-sqlite3'

  export const BUSY_TIMEOUT_MS = 2000

  export interface CoverageDbReader {
    all<T>(sql: string, ...params: unknown[]): T[]
    get<T>(sql: string, ...params: unknown[]): T | undefined
    close(): void
  }

  /** SQLITE_BUSY（写入方持锁超 busy_timeout）——路由层映射 503（spec §4） */
  export class DbBusyError extends Error {
    constructor(cause: unknown) {
      super('coverage.db busy — run in progress')
      this.name = 'DbBusyError'
      this.cause = cause
    }
  }

  export interface OpenReaderOptions {
    busyTimeoutMs?: number
  }

  export function openReader(dbPath: string, opts: OpenReaderOptions = {}): CoverageDbReader | null {
    if (!existsSync(dbPath)) return null
    let db: Database.Database
    try {
      db = new Database(dbPath, { readonly: true })
    } catch {
      return null // 文件损坏/权限等——按降级处理（spec §4），不抛
    }
    db.pragma(`busy_timeout = ${opts.busyTimeoutMs ?? BUSY_TIMEOUT_MS}`)
    const guard = <T>(fn: () => T): T => {
      try {
        return fn()
      } catch (err) {
        if ((err as { code?: string }).code === 'SQLITE_BUSY') throw new DbBusyError(err)
        throw err
      }
    }
    return {
      all<T>(sql: string, ...params: unknown[]): T[] {
        return guard(() => (db.prepare(sql) as SqliteStatement).all(...params) as T[])
      },
      get<T>(sql: string, ...params: unknown[]): T | undefined {
        return guard(() => (db.prepare(sql) as SqliteStatement).get(...params) as T | undefined)
      },
      close(): void {
        db.close()
      },
    }
  }
  ```

- [ ] **Step 5: 实现 queries.ts**

  ```ts
  /**
   * 五表查询投影（spec §3.1）：SELECT * + 显式 snake→camel 映射，
   * 列集 = §25.1/25.4/25.6/25.7/25.8 逐列（schema 漂移由 Task 0 附注锁定）。
   * DbBusyError 原样上抛（路由层捕获），其余 SQL 错误上抛（fastify 500 可见）。
   */
  import type { CoverageDbReader } from './db-reader.js'
  import type { RunRow, TraceRow, FieldHitRow, UiEvidenceRow, CoverageFieldRow } from '../../shared/api-types.js'

  type Row = Record<string, unknown>

  const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
  const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

  function mapRunRow(r: Row): RunRow {
    return {
      id: String(r.id),
      startedAt: str(r.started_at),
      endedAt: str(r.ended_at),
      status: String(r.status),
      projectName: str(r.project_name),
      dashboardUrl: str(r.dashboard_url),
      manifestHash: str(r.manifest_hash),
      configPath: str(r.config_path),
      resolvedConfigPath: str(r.resolved_config_path),
      terminatedBy: str(r.terminated_by),
    }
  }

  function mapTraceRow(r: Row): TraceRow {
    return {
      id: String(r.id),
      runId: String(r.run_id),
      traceId: String(r.trace_id),
      scenarioId: str(r.scenario_id),
      dslStepId: str(r.dsl_step_id),
      endpointId: str(r.endpoint_id),
      method: String(r.method),
      url: String(r.url),
      path: str(r.path),
      status: int(r.status),
      durationMs: int(r.duration_ms),
      startedAt: str(r.started_at),
      endedAt: str(r.ended_at),
      replayable: int(r.replayable),
      replaySafety: str(r.replay_safety),
      replayReason: str(r.replay_reason),
    }
  }

  function mapHitRow(r: Row): FieldHitRow {
    return {
      id: String(r.id),
      runId: String(r.run_id),
      requestId: str(r.request_id),
      endpointId: str(r.endpoint_id),
      fieldId: str(r.field_id),
      fieldPath: String(r.field_path),
      normalizedPath: String(r.normalized_path),
      count: Number(r.count),
      firstHitAt: str(r.first_hit_at),
      lastHitAt: str(r.last_hit_at),
      route: str(r.route),
      source: str(r.source),
    }
  }

  function mapEvidenceRow(r: Row): UiEvidenceRow {
    return {
      id: String(r.id),
      runId: String(r.run_id),
      requestId: str(r.request_id),
      fieldId: str(r.field_id),
      fieldPath: String(r.field_path),
      evidenceType: str(r.evidence_type),
      selector: str(r.selector),
      visible: int(r.visible),
      inViewport: int(r.in_viewport),
      route: str(r.route),
      screenshotPath: str(r.screenshot_path),
      textSample: str(r.text_sample),
    }
  }

  function mapCoverageFieldRow(r: Row): CoverageFieldRow {
    return {
      id: String(r.id),
      runId: String(r.run_id),
      fieldId: String(r.field_id),
      endpointId: str(r.endpoint_id),
      fieldPath: String(r.field_path),
      policyStatus: String(r.policy_status),
      coverageState: String(r.coverage_state),
      accessHit: int(r.access_hit),
      uiHit: int(r.ui_hit),
      assertionHit: int(r.assertion_hit),
      suspicious: int(r.suspicious),
      countedRequired: int(r.counted_required),
      countedEffective: int(r.counted_effective),
    }
  }

  export class Queries {
    constructor(private readonly reader: CoverageDbReader) {}

    getRun(runId: string): RunRow | undefined {
      const r = this.reader.get<Row>('SELECT * FROM runs WHERE id = ?', runId)
      return r === undefined ? undefined : mapRunRow(r)
    }

    listRuns(): RunRow[] {
      return this.reader.all<Row>('SELECT * FROM runs ORDER BY started_at').map(mapRunRow)
    }

    listTraces(runId: string): TraceRow[] {
      return this.reader
        .all<Row>('SELECT * FROM request_traces WHERE run_id = ? ORDER BY started_at', runId)
        .map(mapTraceRow)
    }

    getTrace(runId: string, traceId: string): TraceRow | undefined {
      const r = this.reader.get<Row>(
        'SELECT * FROM request_traces WHERE run_id = ? AND trace_id = ?',
        runId, traceId,
      )
      return r === undefined ? undefined : mapTraceRow(r)
    }

    listHitsByRequest(runId: string, requestId: string): FieldHitRow[] {
      return this.reader
        .all<Row>('SELECT * FROM field_hits WHERE run_id = ? AND request_id = ? ORDER BY last_hit_at', runId, requestId)
        .map(mapHitRow)
    }

    listEvidenceByRequest(runId: string, requestId: string): UiEvidenceRow[] {
      return this.reader
        .all<Row>('SELECT * FROM ui_evidence WHERE run_id = ? AND request_id = ? ORDER BY field_path', runId, requestId)
        .map(mapEvidenceRow)
    }

    listCoverageFields(runId: string): CoverageFieldRow[] {
      return this.reader
        .all<Row>('SELECT * FROM coverage_fields WHERE run_id = ? ORDER BY field_path', runId)
        .map(mapCoverageFieldRow)
    }
  }
  ```

- [ ] **Step 6: 跑测试确认通过**

  Run: `corepack pnpm --filter @nx-mk/dashboard test` → 全绿（busy 用例含 50ms 超时，整包 <5s）

- [ ] **Step 7: 提交**

  ```bash
  git add packages/dashboard/src
  git commit -m "feat(dashboard): coverage.db 只读层 + 五表查询投影"
  ```

---

### Task 4: 7 条只读 API 路由 + 集成契约测试

**Files:**
- Create: `packages/dashboard/src/server/routes/runs.ts`
- Create: `packages/dashboard/src/server/routes/metrics.ts`
- Create: `packages/dashboard/src/server/routes/requests.ts`
- Create: `packages/dashboard/src/server/routes/fields.ts`
- Create: `packages/dashboard/src/server/routes/ignored.ts`
- Modify: `packages/dashboard/src/server/index.ts`（注册路由）
- Create: `packages/dashboard/src/__tests__/routes.test.ts`
- Create: `tests/integration/phase4-dashboard.test.ts`

**Interfaces:**
- Consumes: Task 1 `buildServer/RouteContext`、Task 2 `listRuns/readCoverageReport/reportForRun`、Task 3 `openReader/DbBusyError/BUSY_TIMEOUT_MS/Queries`、fixtures `makeNxMkDir/reportFixture/writeReportFile/seedDb`
- Produces（7 条路由，响应形状 = api-types.ts，Task 7/8 的 UI 按此消费）:
  - `GET /api/runs` → `RunsListResponse`
  - `GET /api/runs/:runId` → `RunDetailResponse`（未知 → 404 `{error}`）
  - `GET /api/runs/:runId/metrics` → `MetricsResponse`（未知 run → 404；report 缺失/runId 不匹配 → 404 + hint）
  - `GET /api/runs/:runId/requests` → `RequestsListResponse`（report 命中 → report.requests；否则 request_traces 投影；db 缺 → `{requests:[]}`）
  - `GET /api/runs/:runId/requests/:requestId` → `RequestDetailResponse`（traces 与 report 均无 → 404）
  - `GET /api/runs/:runId/fields` → `FieldsListResponse`（db 缺 → `{fields:[]}`；report 命中时按 fieldPath 富化 hitCount/matchedRule）
  - `GET /api/runs/:runId/ignored` → `IgnoredListResponse`（report 缺失 → 404 + hint）
  - 全部路由：`DbBusyError` → 503 `{error, hint}`

- [ ] **Step 1: 写失败测试（路由层）**

  `packages/dashboard/src/__tests__/routes.test.ts`：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import Database from 'better-sqlite3'
  import { writeFileSync, rmSync } from 'node:fs'
  import { join } from 'node:path'
  import { buildServer } from '../server/index.js'
  import type { FastifyInstance } from 'fastify'
  import type {
    RunsListResponse, RunDetailResponse, MetricsResponse,
    RequestsListResponse, RequestDetailResponse, FieldsListResponse, IgnoredListResponse,
  } from '../shared/api-types.js'
  import { makeNxMkDir, reportFixture, writeReportFile, seedDb } from './fixtures.js'

  let dir: string
  let app: FastifyInstance

  beforeEach(() => {
    dir = makeNxMkDir([
      { runId: 'run_a', withEvents: true },   // 旧 run：无 db 行、无 report
      { runId: 'run_b' },                      // 最新 run：db 行 + report
    ])
    writeFileSync(join(dir, '.nx-mk', 'manifest.json'), '{}')
    seedDb(dir, {
      runs: [
        { id: 'run_b', status: 'completed', terminatedBy: 'goal-met', endedAt: '2026-09-17T10:00:05.000Z' },
        { id: 'run_a', status: 'failed' },
      ],
      traces: [
        { runId: 'run_b', traceId: 'req_1', method: 'GET', url: 'http://local/1', path: '/users/1', status: 200, durationMs: 12, startedAt: '2026-09-17T10:00:01.000Z' },
        { runId: 'run_a', traceId: 'req_old', method: 'GET', url: 'http://local/old', path: '/users/9', status: 200, durationMs: 5, startedAt: '2026-09-17T09:00:01.000Z' },
      ],
      hits: [{ runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', count: 3 }],
      evidence: [{ runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', textSample: 'Ada' }],
      coverageFields: [
        { runId: 'run_b', fieldPath: 'data.id', policyStatus: 'required', coverageState: 'covered' },
        { runId: 'run_b', fieldPath: 'data.internalRiskScore', policyStatus: 'ignored', coverageState: 'ignored' },
      ],
    })
    writeReportFile(dir, reportFixture('run_b'))
    app = buildServer({ nxMkDir: join(dir, '.nx-mk'), uiDistDir: join(dir, 'ui'), busyTimeoutMs: 50 })
  })
  afterEach(async () => {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('GET /api/runs', () => {
    it('newest first + db 富化 + manifestAvailable', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs' })
      expect(res.statusCode).toBe(200)
      const body = res.json<RunsListResponse>()
      expect(body.manifestAvailable).toBe(true)
      expect(body.runs.map((r) => r.runId)).toEqual(['run_b', 'run_a'])
      expect(body.runs[0]).toMatchObject({ status: 'completed', terminatedBy: 'goal-met', hasReport: true, hasEvents: false })
      expect(body.runs[1]).toMatchObject({ status: 'failed', hasReport: false, hasEvents: true })
    })
    it('.nx-mk 缺失 → 空列表（spec §4）', async () => {
      const empty = buildServer({ nxMkDir: join(dir, 'no-such'), uiDistDir: join(dir, 'ui') })
      const res = await empty.inject({ method: 'GET', url: '/api/runs' })
      expect(res.json<RunsListResponse>()).toEqual({ runs: [], manifestAvailable: false })
      await empty.close()
    })
  })

  describe('GET /api/runs/:runId', () => {
    it('detail with dbRow', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_b' })
      const body = res.json<RunDetailResponse>()
      expect(body.dbRow?.terminatedBy).toBe('goal-met')
      expect(body.hasReport).toBe(true)
    })
    it('unknown run → 404', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_x' })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /api/runs/:runId/metrics', () => {
    it('report 命中 → metrics', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/metrics' })
      const body = res.json<MetricsResponse>()
      expect(body.metrics.requiredCoverage).toBe(1)
      expect(body.terminatedBy).toBe('goal-met')
    })
    it('旧 run（report runId 不匹配）→ 404 + hint', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/metrics' })
      expect(res.statusCode).toBe(404)
      expect(res.json().hint).toContain('nx-mk run')
    })
  })

  describe('GET /api/runs/:runId/requests', () => {
    it('report 命中 → report.requests', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/requests' })
      expect(res.json<RequestsListResponse>().requests[0]?.requestId).toBe('req_1')
    })
    it('无 report → request_traces 投影回落（run_a）', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/requests' })
      const reqs = res.json<RequestsListResponse>().requests
      expect(reqs).toHaveLength(1)
      expect(reqs[0]).toMatchObject({ requestId: 'req_old', method: 'GET' })
    })
  })

  describe('GET /api/runs/:runId/requests/:requestId', () => {
    it('trace + 关联 hits/evidence', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/requests/req_1' })
      const body = res.json<RequestDetailResponse>()
      expect(body.trace.traceId).toBe('req_1')
      expect(body.hits).toHaveLength(1)
      expect(body.evidence[0]?.textSample).toBe('Ada')
    })
    it('unknown requestId → 404', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/requests/req_99' })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /api/runs/:runId/fields', () => {
    it('db 行 + report 富化（hitCount/matchedRule）', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/fields' })
      const fields = res.json<FieldsListResponse>().fields
      expect(fields).toHaveLength(2)
      const ignored = fields.find((f) => f.fieldPath === 'data.internalRiskScore')
      expect(ignored?.hitCount).toBe(1)
      expect(ignored?.matchedRule?.pattern).toBe('data.internalRiskScore')
      const covered = fields.find((f) => f.fieldPath === 'data.id')
      expect(covered?.hitCount).toBeUndefined()
    })
    it('db 缺失 → {fields:[]}（spec §4）', async () => {
      // 用一个没有 coverage.db 的 .nx-mk
      const dir2 = makeNxMkDir([{ runId: 'run_c' }])
      const app2 = buildServer({ nxMkDir: join(dir2, '.nx-mk'), uiDistDir: join(dir, 'ui') })
      const res = await app2.inject({ method: 'GET', url: '/api/runs/run_c/fields' })
      expect(res.json<FieldsListResponse>()).toEqual({ fields: [] })
      await app2.close()
      rmSync(dir2, { recursive: true, force: true })
    })
  })

  describe('GET /api/runs/:runId/ignored', () => {
    it('report 命中 → ignored 列表', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/ignored' })
      const body = res.json<IgnoredListResponse>()
      expect(body.ignored).toHaveLength(1)
      expect(body.ignored[0]?.fieldPath).toBe('data.internalRiskScore')
    })
    it('旧 run → 404', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/ignored' })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('busy → 503', () => {
    it('写锁持有期间查询 → 503 + hint', async () => {
      const writer = new Database(join(dir, '.nx-mk', 'coverage.db'))
      writer.exec('BEGIN EXCLUSIVE')
      try {
        const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/fields' })
        expect(res.statusCode).toBe(503)
        expect(res.json().hint).toContain('run in progress')
      } finally {
        writer.exec('ROLLBACK')
        writer.close()
      }
    })
  })
  ```

- [ ] **Step 2: 写失败集成测试**

  `tests/integration/phase4-dashboard.test.ts`：

  ```ts
  /**
   * Phase 4 集成（hermetic，spec §6）：真 SQLite fixture + 真 report.json →
   * buildServer 后 7 条路由端到端 inject 契约抽查。
   * 真实链路（nx-mk start + 浏览器）= demo 手动验收（README 步骤）。
   */
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { rmSync } from 'node:fs'
  import { join } from 'node:path'
  import { buildServer } from '../../packages/dashboard/src/server/index.js'
  import { makeNxMkDir, reportFixture, writeReportFile, seedDb } from '../../packages/dashboard/src/__tests__/fixtures.js'

  let dir: string

  beforeEach(() => {
    dir = makeNxMkDir([{ runId: 'run_b', withEvents: true }])
    seedDb(dir, {
      runs: [{ id: 'run_b', status: 'completed', terminatedBy: 'goal-met' }],
      traces: [{ runId: 'run_b', traceId: 'req_1', method: 'GET', url: 'http://local/1', path: '/users/1', status: 200 }],
      hits: [{ runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name' }],
      evidence: [{ runId: 'run_b', requestId: 'req_1', fieldPath: 'data.name', textSample: 'Ada', visible: true }],
      coverageFields: [{ runId: 'run_b', fieldPath: 'data.name', policyStatus: 'required', coverageState: 'covered' }],
    })
    writeReportFile(dir, reportFixture('run_b'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function makeApp() {
    return buildServer({ nxMkDir: join(dir, '.nx-mk'), uiDistDir: join(dir, 'ui') })
  }

  it('三点审计链互证：runs 行 + report 指标 + events 存在性', async () => {
    const app = makeApp()
    const runs = (await app.inject({ method: 'GET', url: '/api/runs' })).json()
    expect(runs.runs[0]).toMatchObject({ runId: 'run_b', hasEvents: true, hasReport: true, terminatedBy: 'goal-met' })
    const metrics = (await app.inject({ method: 'GET', url: '/api/runs/run_b/metrics' })).json()
    expect(metrics.metrics.requiredCoverage).toBe(1)
    await app.close()
  })

  it('requests → detail 全链（trace/hits/evidence 关联）', async () => {
    const app = makeApp()
    const list = (await app.inject({ method: 'GET', url: '/api/runs/run_b/requests' })).json()
    expect(list.requests[0].requestId).toBe('req_1')
    const detail = (await app.inject({ method: 'GET', url: '/api/runs/run_b/requests/req_1' })).json()
    expect(detail.trace.method).toBe('GET')
    expect(detail.hits).toHaveLength(1)
    expect(detail.evidence[0].textSample).toBe('Ada')
    await app.close()
  })

  it('fields + ignored 契约', async () => {
    const app = makeApp()
    const fields = (await app.inject({ method: 'GET', url: '/api/runs/run_b/fields' })).json()
    expect(fields.fields[0].fieldPath).toBe('data.name')
    const ignored = (await app.inject({ method: 'GET', url: '/api/runs/run_b/ignored' })).json()
    expect(ignored.ignored[0].fieldPath).toBe('data.internalRiskScore')
    await app.close()
  })
  ```

  注意：集成测试直接 import `packages/dashboard/src/...`（与 phase3 测试 import 包源码/或 dist 的惯例对齐——若仓库集成测试惯例是 import workspace 包名，则改为 `import { buildServer } from '@nx-mk/dashboard'` 与 `from '@nx-mk/dashboard/fixtures'` 不存在——fixtures 不在包导出面。**采用本文件的相对路径 import 源码**，与 phase3 的 `tests/integration/phase3-analyze.test.ts` import 源码风格一致）。

- [ ] **Step 3: 跑测试确认失败**

  Run: `corepack pnpm --filter @nx-mk/dashboard test && npx vitest run tests/integration/phase4`
  Expected: FAIL（路由模块不存在）

- [ ] **Step 4: 实现五个路由文件 + index 注册**

  `packages/dashboard/src/server/routes/runs.ts`：

  ```ts
  /**
   * GET /api/runs、GET /api/runs/:runId（spec §3.5）。
   * 目录扫描为主键来源；db 行可选富化；DbBusyError → 503（spec §4）。
   */
  import { existsSync } from 'node:fs'
  import { join } from 'node:path'
  import type { FastifyInstance, FastifyReply } from 'fastify'
  import type { RouteContext } from '../types.js'
  import { listRuns } from '../store/runs-store.js'
  import { readCoverageReport, reportForRun } from '../store/report-reader.js'
  import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
  import { Queries } from '../store/queries.js'
  import type { RunListItem, RunsListResponse, RunDetailResponse } from '../../shared/api-types.js'

  /** DbBusyError → 503 + hint；其余原样上抛（fastify 500 可见） */
  function busyGuard(reply: FastifyReply, err: unknown): { handled: boolean } {
    if (err instanceof DbBusyError) {
      void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
      return { handled: true }
    }
    throw err
  }

  export function registerRunRoutes(app: FastifyInstance, ctx: RouteContext): void {
    const readerOpts = { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS }

    app.get('/api/runs', async (_req, reply) => {
      try {
        const fileRuns = listRuns(ctx.nxMkDir)
        const report = readCoverageReport(ctx.nxMkDir)
        const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
        let runs: RunListItem[]
        try {
          const queries = reader ? new Queries(reader) : null
          runs = [...fileRuns].reverse().map(({ runId, hasEvents }) => {
            const row = queries?.getRun(runId)
            const item: RunListItem = {
              runId,
              hasEvents,
              hasReport: report !== null && report.runId === runId,
              ...(row?.status !== undefined ? { status: row.status } : {}),
              ...(row?.startedAt != null ? { startedAt: row.startedAt } : {}),
              ...(row?.endedAt != null ? { endedAt: row.endedAt } : {}),
              ...(row?.terminatedBy != null ? { terminatedBy: row.terminatedBy } : {}),
            }
            return item
          })
        } finally {
          reader?.close()
        }
        const res: RunsListResponse = {
          runs,
          manifestAvailable: existsSync(join(ctx.nxMkDir, 'manifest.json')),
        }
        return res
      } catch (err) {
        busyGuard(reply, err)
      }
    })

    app.get('/api/runs/:runId', async (req, reply) => {
      const { runId } = req.params as { runId: string }
      if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
        return reply.code(404).send({ error: `unknown run: ${runId}` })
      }
      try {
        const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
        try {
          const row = reader ? new Queries(reader).getRun(runId) ?? null : null
          const report = reportForRun(ctx.nxMkDir, runId)
          const res: RunDetailResponse = {
            runId,
            hasEvents: existsSync(join(ctx.nxMkDir, 'runs', runId, 'events.jsonl')),
            hasReport: report !== null,
            ...(row?.status !== undefined ? { status: row.status } : {}),
            ...(row?.startedAt != null ? { startedAt: row.startedAt } : {}),
            ...(row?.endedAt != null ? { endedAt: row.endedAt } : {}),
            ...(row?.terminatedBy != null ? { terminatedBy: row.terminatedBy } : {}),
            dbRow: row,
          }
          return res
        } finally {
          reader?.close()
        }
      } catch (err) {
        busyGuard(reply, err)
      }
    })
  }
  ```

  `packages/dashboard/src/server/routes/metrics.ts`：

  ```ts
  /** GET /api/runs/:runId/metrics（spec §3.5）：report 命中 → 三指标 + 状态富化 */
  import { existsSync } from 'node:fs'
  import { join } from 'node:path'
  import type { FastifyInstance } from 'fastify'
  import type { RouteContext } from '../types.js'
  import { reportForRun } from '../store/report-reader.js'
  import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
  import { Queries } from '../store/queries.js'
  import type { MetricsResponse } from '../../shared/api-types.js'

  export function registerMetricsRoutes(app: FastifyInstance, ctx: RouteContext): void {
    app.get('/api/runs/:runId/metrics', async (req, reply) => {
      const { runId } = req.params as { runId: string }
      if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
        return reply.code(404).send({ error: `unknown run: ${runId}` })
      }
      const report = reportForRun(ctx.nxMkDir, runId)
      if (!report) {
        return reply.code(404).send({
          error: 'coverage report unavailable',
          hint: 'coverage-report.json is written at run end; re-run nx-mk run',
        })
      }
      // 状态富化失败（busy 等）不阻断 metrics 返回——降级精神（spec §4）
      let status: string | undefined
      let terminatedBy: string | undefined
      try {
        const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS })
        try {
          const row = reader ? new Queries(reader).getRun(runId) : undefined
          if (row?.status !== undefined) status = row.status
          if (row?.terminatedBy != null) terminatedBy = row.terminatedBy
        } finally {
          reader?.close()
        }
      } catch (err) {
        if (!(err instanceof DbBusyError)) throw err
      }
      const res: MetricsResponse = {
        runId,
        ...(status !== undefined ? { status } : {}),
        ...(terminatedBy !== undefined ? { terminatedBy } : {}),
        metrics: report.metrics,
      }
      return res
    })
  }
  ```

  `packages/dashboard/src/server/routes/requests.ts`：

  ```ts
  /**
   * GET /api/runs/:runId/requests、…/:requestId（spec §3.5）。
   * 列表：report 命中 → report.requests；否则 request_traces 投影回落（旧 run）。
   * 详情：db trace 行优先；db 无行时回落 report 摘要拼装（同源数据的防御路径）。
   */
  import { existsSync } from 'node:fs'
  import { join } from 'node:path'
  import type { FastifyInstance, FastifyReply } from 'fastify'
  import type { RouteContext } from '../types.js'
  import { reportForRun } from '../store/report-reader.js'
  import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
  import { Queries } from '../store/queries.js'
  import type { TraceRow, RequestsListResponse, RequestDetailResponse } from '../../shared/api-types.js'
  import type { RequestTraceSummary } from '@nx-mk/coverage'

  function busy503(reply: FastifyReply): { handled: true } {
    void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
    return { handled: true }
  }

  export function registerRequestRoutes(app: FastifyInstance, ctx: RouteContext): void {
    const readerOpts = { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS }

    app.get('/api/runs/:runId/requests', async (req, reply) => {
      const { runId } = req.params as { runId: string }
      if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
        return reply.code(404).send({ error: `unknown run: ${runId}` })
      }
      const report = reportForRun(ctx.nxMkDir, runId)
      if (report) return { requests: report.requests } satisfies RequestsListResponse
      try {
        const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
        try {
          if (!reader) return { requests: [] } satisfies RequestsListResponse
          const requests: RequestTraceSummary[] = new Queries(reader).listTraces(runId).map((t) => ({
            requestId: t.traceId,
            ...(t.endpointId != null ? { endpointId: t.endpointId } : {}),
            method: t.method,
            url: t.url,
            ...(t.path != null ? { path: t.path } : {}),
            ...(t.status != null ? { status: t.status } : {}),
            ...(t.durationMs != null ? { durationMs: t.durationMs } : {}),
            ...(t.startedAt != null ? { startedAt: t.startedAt } : {}),
            ...(t.endedAt != null ? { endedAt: t.endedAt } : {}),
          }))
          return { requests } satisfies RequestsListResponse
        } finally {
          reader?.close()
        }
      } catch (err) {
        if (err instanceof DbBusyError) return busy503(reply)
        throw err
      }
    })

    app.get('/api/runs/:runId/requests/:requestId', async (req, reply) => {
      const { runId, requestId } = req.params as { runId: string; requestId: string }
      if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
        return reply.code(404).send({ error: `unknown run: ${runId}` })
      }
      try {
        const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
        try {
          const queries = reader ? new Queries(reader) : null
          let trace: TraceRow | undefined = queries?.getTrace(runId, requestId)
          if (!trace) {
            const report = reportForRun(ctx.nxMkDir, runId)
            const summary = report?.requests.find((r) => r.requestId === requestId)
            if (!summary) return reply.code(404).send({ error: `unknown request: ${requestId}` })
            trace = {
              id: `rt_${runId}_${requestId}`, runId, traceId: requestId,
              scenarioId: null, dslStepId: null, endpointId: summary.endpointId ?? null,
              method: summary.method ?? '', url: summary.url ?? '', path: summary.path ?? null,
              status: summary.status ?? null, durationMs: summary.durationMs ?? null,
              startedAt: summary.startedAt ?? null, endedAt: summary.endedAt ?? null,
              replayable: null, replaySafety: null, replayReason: null,
            }
          }
          const res: RequestDetailResponse = {
            trace,
            hits: queries?.listHitsByRequest(runId, requestId) ?? [],
            evidence: queries?.listEvidenceByRequest(runId, requestId) ?? [],
          }
          return res
        } finally {
          reader?.close()
        }
      } catch (err) {
        if (err instanceof DbBusyError) return busy503(reply)
        throw err
      }
    })
  }
  ```

  `packages/dashboard/src/server/routes/fields.ts`：

  ```ts
  /**
   * GET /api/runs/:runId/fields（spec §3.5）：coverage_fields 行为基座；
   * report 命中该 run 时按 fieldPath 富化 hitCount/matchedRule（两值不在 §25.8 列中）。
   */
  import { existsSync } from 'node:fs'
  import { join } from 'node:path'
  import type { FastifyInstance, FastifyReply } from 'fastify'
  import type { RouteContext } from '../types.js'
  import { reportForRun } from '../store/report-reader.js'
  import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
  import { Queries } from '../store/queries.js'
  import type { FieldsListResponse } from '../../shared/api-types.js'
  import type { FieldCoverageItem } from '@nx-mk/coverage'

  function busy503(reply: FastifyReply): { handled: true } {
    void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
    return { handled: true }
  }

  export function registerFieldRoutes(app: FastifyInstance, ctx: RouteContext): void {
    app.get('/api/runs/:runId/fields', async (req, reply) => {
      const { runId } = req.params as { runId: string }
      if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
        return reply.code(404).send({ error: `unknown run: ${runId}` })
      }
      try {
        const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS })
        try {
          if (!reader) return { fields: [] } satisfies FieldsListResponse
          const rows = new Queries(reader).listCoverageFields(runId)
          const report = reportForRun(ctx.nxMkDir, runId)
          const items: FieldCoverageItem[] = report
            ? [
                ...report.missingRequiredFields,
                ...report.weakEvidenceFields,
                ...report.ignoredReturnedFields,
                ...report.suspiciousCoverage,
              ]
            : []
          const byPath = new Map(items.map((i) => [i.fieldPath, i]))
          const res: FieldsListResponse = {
            fields: rows.map((row) => {
              const item = byPath.get(row.fieldPath)
              return {
                ...row,
                ...(item?.hitCount !== undefined ? { hitCount: item.hitCount } : {}),
                ...(item?.matchedRule !== undefined ? { matchedRule: item.matchedRule } : {}),
              }
            }),
          }
          return res
        } finally {
          reader?.close()
        }
      } catch (err) {
        if (err instanceof DbBusyError) return busy503(reply)
        throw err
      }
    })
  }
  ```

  `packages/dashboard/src/server/routes/ignored.ts`：

  ```ts
  /** GET /api/runs/:runId/ignored（spec §3.5）：report 的 ignoredReturnedFields 清单 */
  import { existsSync } from 'node:fs'
  import { join } from 'node:path'
  import type { FastifyInstance } from 'fastify'
  import type { RouteContext } from '../types.js'
  import { reportForRun } from '../store/report-reader.js'
  import type { IgnoredListResponse } from '../../shared/api-types.js'

  export function registerIgnoredRoutes(app: FastifyInstance, ctx: RouteContext): void {
    app.get('/api/runs/:runId/ignored', async (req, reply) => {
      const { runId } = req.params as { runId: string }
      if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
        return reply.code(404).send({ error: `unknown run: ${runId}` })
      }
      const report = reportForRun(ctx.nxMkDir, runId)
      if (!report) {
        return reply.code(404).send({
          error: 'coverage report unavailable',
          hint: 'coverage-report.json is written at run end; re-run nx-mk run',
        })
      }
      return { ignored: report.ignoredReturnedFields } satisfies IgnoredListResponse
    })
  }
  ```

  `packages/dashboard/src/server/index.ts`（Modify——注册路由）：

  ```ts
  /**
   * buildServer —— Dashboard server 工厂（spec §3.2）：
   * 静态托管 + 7 条只读 /api 路由。logger 关闭：本地分析台，stdout 由 start 命令管理。
   */
  import Fastify, { type FastifyInstance } from 'fastify'
  import { registerStatic } from './static.js'
  import { registerRunRoutes } from './routes/runs.js'
  import { registerMetricsRoutes } from './routes/metrics.js'
  import { registerRequestRoutes } from './routes/requests.js'
  import { registerFieldRoutes } from './routes/fields.js'
  import { registerIgnoredRoutes } from './routes/ignored.js'

  export interface BuildServerOptions {
    /** .nx-mk 目录（绝对或相对 cwd） */
    nxMkDir: string
    /** UI 产物目录（index.html 所在） */
    uiDistDir: string
    /** SQLite busy_timeout 覆盖（测试注入小值）；缺省 2000ms */
    busyTimeoutMs?: number
  }

  export function buildServer(opts: BuildServerOptions): FastifyInstance {
    const app = Fastify({ logger: false })
    registerStatic(app, opts.uiDistDir)
    const ctx = { nxMkDir: opts.nxMkDir, ...(opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: opts.busyTimeoutMs } : {}) }
    registerRunRoutes(app, ctx)
    registerMetricsRoutes(app, ctx)
    registerRequestRoutes(app, ctx)
    registerFieldRoutes(app, ctx)
    registerIgnoredRoutes(app, ctx)
    return app
  }
  ```

- [ ] **Step 5: 跑测试确认通过**

  Run: `corepack pnpm --filter @nx-mk/dashboard test` → 全绿（busy 用例 ~50ms）
  Run: `npx vitest run tests/integration/phase4-dashboard.test.ts` → PASS（3 用例）
  Run: `corepack pnpm --filter @nx-mk/dashboard typecheck` → 绿

- [ ] **Step 6: 提交**

  ```bash
  git add packages/dashboard/src tests/integration/phase4-dashboard.test.ts
  git commit -m "feat(dashboard): 7 条只读 API 路由 + 集成契约测试"
  ```

---

### Task 5: config dashboard 段 + subcommand 类型扩展

**Files:**
- Modify: `packages/config/src/schema.ts`（+DashboardConfigSchema +ConfigSchema.dashboard）
- Modify: `packages/config/src/index.ts`（导出）
- Modify: `packages/config/src/loader.ts:55`（LoadConfigInput.subcommand + 'start'）
- Modify: `packages/kernel/src/types.ts`（ResolvedConfig.subcommand + 'start'）
- Test: `packages/config/src/__tests__/dashboard-schema.test.ts`（新建）

**Interfaces:**
- Consumes: 既有 zod ConfigSchema 惯例（passthrough、optional 段）
- Produces:
  - `DashboardConfigSchema = z.object({ port: z.number().int().min(1).max(65535).optional(), open: z.boolean().optional() })`；`type DashboardConfig = z.infer<...>`（Task 6 的 start.ts 消费）
  - `ConfigSchema.dashboard?: DashboardConfig`
  - `loadConfig` 的 `subcommand` 联合类型扩为 `'run' | 'init' | 'doctor' | 'start'`（kernel `ResolvedConfig['subcommand']` 同步——start 命令 loadConfig 时返回类型收口）

- [ ] **Step 1: 写失败测试**

  `packages/config/src/__tests__/dashboard-schema.test.ts`：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  import { DashboardConfigSchema, ConfigSchema } from '../schema.js'
  import { loadConfig } from '../loader.js'
  import { makeRunId } from '@nx-mk/kernel'

  describe('DashboardConfigSchema', () => {
    it('accepts port + open', () => {
      expect(DashboardConfigSchema.parse({ port: 5000, open: false })).toEqual({ port: 5000, open: false })
    })
    it('accepts empty object', () => {
      expect(DashboardConfigSchema.parse({})).toEqual({})
    })
    it.each([0, -1, 70000, 1.5, '4317'])('rejects invalid port %p', (port) => {
      expect(DashboardConfigSchema.safeParse({ port }).success).toBe(false)
    })
    it('embedded in ConfigSchema (optional, passthrough preserved)', () => {
      const parsed = ConfigSchema.parse({ dashboard: { port: 4317 } })
      expect(parsed.dashboard).toEqual({ port: 4317 })
      expect(ConfigSchema.parse({}).dashboard).toBeUndefined()
    })
  })

  describe('loadConfig with dashboard section + start subcommand', () => {
    let dir: string
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-cfg-')) })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it('parses dashboard section with subcommand start', async () => {
      const path = join(dir, 'nx-mk.config.yml')
      writeFileSync(path, 'plugins: []\ndashboard:\n  port: 5000\n  open: false\n')
      const cfg = await loadConfig({ path, cwd: dir, runId: makeRunId('run_t'), subcommand: 'start' })
      expect(cfg.dashboard).toEqual({ port: 5000, open: false })
    })
    it('invalid dashboard.port → KernelError CONFIG_INVALID', async () => {
      const path = join(dir, 'nx-mk.config.yml')
      writeFileSync(path, 'dashboard:\n  port: 70000\n')
      await expect(
        loadConfig({ path, cwd: dir, runId: makeRunId('run_t'), subcommand: 'start' }),
      ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    })
  })
  ```

- [ ] **Step 2: 跑测试确认失败**

  Run: `corepack pnpm --filter @nx-mk/config test`
  Expected: FAIL（DashboardConfigSchema 未导出 / subcommand 类型不含 'start' 编译错）

- [ ] **Step 3: 实现 schema + 导出**

  `packages/config/src/schema.ts`（在 CoverageConfigSchema 之后追加；ConfigSchema 对象加一行）：

  ```ts
  // Phase 4（spec §2.2/§3.6）：dashboard 段 —— start 命令消费的最小集（spec D10：defaultView 不收）
  export const DashboardConfigSchema = z.object({
    port: z.number().int().min(1).max(65535).optional(),
    open: z.boolean().optional(),
  })
  export type DashboardConfig = z.infer<typeof DashboardConfigSchema>
  ```

  ConfigSchema 对象内在 `coverage: CoverageConfigSchema.optional(),` 后加：

  ```ts
    // Phase 4：可选 dashboard 段（spec §3.6 —— start 命令消费 port/open）
    dashboard: DashboardConfigSchema.optional(),
  ```

  `packages/config/src/index.ts` 导出行追加 `DashboardConfigSchema, type DashboardConfig`。

- [ ] **Step 4: 扩 subcommand 联合类型（两处）**

  定位：`grep -rn "'run' | 'init' | 'doctor'" packages/kernel/src packages/config/src`

  - `packages/config/src/loader.ts` 的 `LoadConfigInput.subcommand` → `'run' | 'init' | 'doctor' | 'start'`
  - `packages/kernel/src/types.ts` 中 `ResolvedConfig` 的 `subcommand` 字段 → 加 `| 'start'`
  - **不改** `CreateKernelOptions.subcommand`（start 命令不创建 kernel；保持窄面）

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

  Run: `corepack pnpm --filter @nx-mk/config test` → PASS
  Run: `corepack pnpm --filter @nx-mk/kernel typecheck && corepack pnpm --filter @nx-mk/cli typecheck` → 绿（联合类型扩展无下游破坏）

- [ ] **Step 6: 提交**

  ```bash
  git add packages/config packages/kernel/src/types.ts
  git commit -m "feat(config): dashboard 配置段 + start 子命令类型扩展"
  ```

---

### Task 6: nx-mk start 命令

**Files:**
- Create: `packages/cli/src/commands/start.ts`
- Modify: `packages/cli/src/index.ts`（子命令路由 + flag + HELP）
- Modify: `packages/cli/package.json`（+`@nx-mk/dashboard` 依赖）
- Test: `packages/cli/src/__tests__/start.test.ts`（新建）

**Interfaces:**
- Consumes: `buildServer/resolveUiDistDir`（Task 1）、`loadConfig/DashboardConfig`（Task 5）、`runMain`（既有 `packages/cli/src/commands/run.ts`）、`generateRunId`（cli index 既有局部函数）
- Produces:
  - `startMain(opts: StartMainOptions): Promise<void>`
  - `interface StartMainOptions { configPath: string; runId: string; cwd?: string; port?: number; noRun?: boolean; cliOverrides?: { logLevel?: LogLevel; outputDir?: string }; deps?: StartDeps }`
  - `interface StartDeps { startServer: (port: number, host: string) => Promise<void>; runOnce: () => Promise<void>; openBrowser: (url: string) => void }`（测试缝：默认实现 = 真 listen / 动态 import runMain / 平台开浏览器）
  - CLI：`nx-mk start [--port <n>] [--no-run]`

- [ ] **Step 1: cli/package.json 加依赖**

  `dependencies` 增加 `"@nx-mk/dashboard": "workspace:*"`，随后 `corepack pnpm install`。

- [ ] **Step 2: 写失败测试**

  `packages/cli/src/__tests__/start.test.ts`：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  import { startMain } from '../commands/start.js'

  function writeConfig(dir: string): string {
    const path = join(dir, 'nx-mk.config.yml')
    writeFileSync(path, 'plugins: []\ndashboard:\n  port: 5000\n  open: false\n')
    return path
  }

  describe('startMain', () => {
    let dir: string
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-start-')) })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it('listens on config port, opens browser, runs analysis', async () => {
      const calls: { port?: number; host?: string; opened?: string; ran?: boolean } = {}
      await startMain({
        configPath: writeConfig(dir), runId: 'run_t1', cwd: dir,
        deps: {
          startServer: async (port, host) => { calls.port = port; calls.host = host },
          runOnce: async () => { calls.ran = true },
          openBrowser: (url) => { calls.opened = url },
        },
      })
      expect(calls.port).toBe(5000)
      expect(calls.host).toBe('127.0.0.1')
      expect(calls.opened).toBe('http://127.0.0.1:5000')
      expect(calls.ran).toBe(true)
    })

    it('--no-run skips analysis', async () => {
      let ran = false
      await startMain({
        configPath: writeConfig(dir), runId: 'run_t2', cwd: dir, noRun: true,
        deps: { startServer: async () => {}, runOnce: async () => { ran = true }, openBrowser: () => {} },
      })
      expect(ran).toBe(false)
    })

    it('CLI --port overrides config; config open:false skips browser', async () => {
      const calls: Record<string, unknown> = {}
      await startMain({
        configPath: writeConfig(dir), runId: 'run_t3', cwd: dir, port: 6000,
        deps: {
          startServer: async (port) => { calls.port = port },
          runOnce: async () => {},
          openBrowser: (url) => { calls.opened = url },
        },
      })
      expect(calls.port).toBe(6000)
      expect(calls.opened).toBeUndefined()
    })

    it('run failure → startMain 仍正常返回（server 保活，spec §4）', async () => {
      await expect(startMain({
        configPath: writeConfig(dir), runId: 'run_t4', cwd: dir,
        deps: {
          startServer: async () => {},
          runOnce: async () => { throw new Error('boom') },
          openBrowser: () => {},
        },
      })).resolves.toBeUndefined()
    })

    it('EADDRINUSE → KernelError（顶层映射非零退出码）', async () => {
      const err = Object.assign(new Error('listen EADDRINUSE 127.0.0.1:5000'), { code: 'EADDRINUSE' })
      await expect(startMain({
        configPath: writeConfig(dir), runId: 'run_t5', cwd: dir,
        deps: { startServer: async () => { throw err }, runOnce: async () => {}, openBrowser: () => {} },
      })).rejects.toMatchObject({ code: 'KERNEL_INTERNAL' })
    })

    it('无 config → CONFIG_NOT_FOUND', async () => {
      await expect(startMain({
        configPath: join(dir, 'missing.yml'), runId: 'run_t6', cwd: dir,
        deps: { startServer: async () => {}, runOnce: async () => {}, openBrowser: () => {} },
      })).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' })
    })
  })
  ```

- [ ] **Step 3: 跑测试确认失败**

  Run: `corepack pnpm --filter @nx-mk/cli test -- start` 或 `npx vitest run packages/cli/src/__tests__/start.test.ts`
  Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 start.ts**

  `packages/cli/src/commands/start.ts`：

  ```ts
  /**
   * start 子命令 —— 一键启动本地 Dashboard + 分析（spec §3.6）
   *
   * 顺序：loadConfig（dashboard 段校验）→ buildServer → listen(127.0.0.1) →
   * 打印 URL →（open: true 默认）best-effort 打开浏览器 → 动态 import runMain 跑一次分析。
   * run 失败不关 server（spec §4）：catch 打印错误摘要，failed run 在页面可见；
   * 仅 listen 失败（EADDRINUSE 等）向上抛错（CLI 顶层映射非零退出码）。
   *
   * 测试缝（deps）：startServer / runOnce / openBrowser 可注入——
   * 测试不占真端口、不真跑 run、不真开浏览器。
   */
  import { join } from 'node:path'
  import { spawn } from 'node:child_process'
  import { KernelError, makeRunId, type LogLevel } from '@nx-mk/kernel'
  import { loadConfig, type DashboardConfig } from '@nx-mk/config'
  import { buildServer, resolveUiDistDir } from '@nx-mk/dashboard'

  export const DEFAULT_DASHBOARD_PORT = 4317

  export interface StartMainOptions {
    configPath: string
    runId: string
    cwd?: string
    /** CLI --port 覆盖（优先级：CLI > config.dashboard.port > 4317） */
    port?: number
    /** CLI --no-run：只 serve 现有产物 */
    noRun?: boolean
    cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
    /** 测试缝：不注入则用真实实现 */
    deps?: StartDeps
  }

  export interface StartDeps {
    startServer: (port: number, host: string) => Promise<void>
    runOnce: () => Promise<void>
    openBrowser: (url: string) => void
  }

  export async function startMain(opts: StartMainOptions): Promise<void> {
    const cwd = opts.cwd ?? process.cwd()
    const config = await loadConfig({
      path: opts.configPath,
      cwd,
      runId: makeRunId(opts.runId),
      subcommand: 'start',
      ...(opts.cliOverrides ? { cliOverrides: opts.cliOverrides } : {}),
    })
    const dash: DashboardConfig = (config as typeof config & { dashboard?: DashboardConfig }).dashboard ?? {}
    const port = opts.port ?? dash.port ?? DEFAULT_DASHBOARD_PORT

    const server = buildServer({
      nxMkDir: join(cwd, '.nx-mk'),
      uiDistDir: resolveUiDistDir(),
    })

    const deps: StartDeps = opts.deps ?? {
      startServer: async (p, host) => {
        await server.listen({ port: p, host })
      },
      runOnce: async () => {
        const { runMain } = await import('./run.js')
        await runMain({
          configPath: opts.configPath,
          runId: opts.runId,
          cwd,
          ...(opts.cliOverrides ? { cliOverrides: opts.cliOverrides } : {}),
        })
      },
      openBrowser: openBrowserBestEffort,
    }

    const url = `http://127.0.0.1:${port}`
    try {
      await deps.startServer(port, '127.0.0.1')
    } catch (err) {
      if ((err as { code?: string }).code === 'EADDRINUSE') {
        throw new KernelError(
          'KERNEL_INTERNAL',
          `port ${port} in use — pass --port <n> or change dashboard.port`,
          err,
        )
      }
      throw err
    }
    console.log(`✔ Dashboard: ${url}`)
    console.log('  Data: .nx-mk/ (read-only)')
    if (dash.open !== false) deps.openBrowser(url)

    if (opts.noRun) {
      console.log('  (--no-run) serving existing artifacts only')
      return
    }
    console.log('  Running analysis… (server stays up if the run fails)')
    try {
      await deps.runOnce()
    } catch (err) {
      // run 失败保活（spec §4）：错误摘要后 server 继续服务，failed run 行在页面可见
      const message = err instanceof KernelError ? `${err.code}: ${err.message}` : (err as Error).message
      console.error(`✖ run failed — dashboard still serving at ${url}`)
      console.error(`  ${message}`)
    }
  }

  /** best-effort 开浏览器（spec §4）：spawn 平台命令，失败仅 warn */
  function openBrowserBestEffort(url: string): void {
    try {
      const cmd = process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : process.platform === 'darwin'
          ? ['open', url]
          : ['xdg-open', url]
      spawn(cmd[0]!, cmd.slice(1), { stdio: 'ignore', detached: true }).unref()
    } catch (err) {
      console.warn(`failed to open browser: ${(err as Error).message}`)
    }
  }
  ```

- [ ] **Step 5: 接线 cli/index.ts**

  五处修改（对照既有代码精确落点）：

  1. import 区加：`import { startMain } from './commands/start.js'`
  2. `type Subcommand = 'run' | 'init' | 'doctor' | 'migrate'` → 加 `| 'start'`
  3. `ParsedArgs` 接口加字段 `start: { port?: number; noRun: boolean }`，并在 `parseArgs` 的初始 `out` 对象里初始化 `start: { noRun: false }`
  4. parseArgs 的 switch 加两个 case（放在 `case '--run-id'` 附近）：

     ```ts
     case '--port': {
       const raw = argv[++i]
       const n = Number(raw)
       if (!Number.isInteger(n) || n < 1 || n > 65535) {
         throw new KernelError('KERNEL_INTERNAL', `Invalid --port: ${raw}`)
       }
       out.start.port = n
       break
     }
     case '--no-run':
       out.start.noRun = true
       break
     ```

     子命令 case 行 `case 'run': case 'init': case 'doctor': case 'migrate':` 加 `case 'start':`
  5. HELP 文本 Subcommands 段加一行、Options 段加两行：

     ```
       start    Start the local Dashboard at 127.0.0.1:4317 (auto-runs analysis unless --no-run)
     ...
       --port <n>             Dashboard port (start only; overrides config dashboard.port)
       --no-run               (start) serve existing artifacts without running analysis
     ```

  6. `main()` 的 switch 加 case（放在 `case 'run'` 前）：

     ```ts
     case 'start': {
       // start 必须有配置文件（dashboard 段 + run 装配都从 config 读）
       const configPath = await resolveConfigPath(args.configPath)
       await startMain({
         configPath,
         runId: args.runId ?? generateRunId(),
         ...(args.start.port !== undefined ? { port: args.start.port } : {}),
         ...(args.start.noRun ? { noRun: true } : {}),
         cliOverrides: { logLevel: args.logLevel, outputDir: args.outputDir },
       })
       return
     }
     ```

- [ ] **Step 6: 跑测试确认通过 + 回归**

  Run: `npx vitest run packages/cli` → 全绿（既有 run/collect 测试不回归）
  Run: `corepack pnpm --filter @nx-mk/cli build && corepack pnpm --filter @nx-mk/cli typecheck` → 绿
  Run: `npx vitest run` → 全量绿

- [ ] **Step 7: 提交**

  ```bash
  git add packages/cli pnpm-lock.yaml
  git commit -m "feat(cli): nx-mk start —— listen 先行 + 自动 run + 失败保活"
  ```

---

### Task 7: UI 纯逻辑 —— hash router / Poller / api client

**Files:**
- Create: `packages/dashboard/src/ui/router.tsx`
- Create: `packages/dashboard/src/ui/api.ts`
- Create: `packages/dashboard/src/ui/poller.ts`
- Create: `packages/dashboard/src/ui/hooks.ts`
- Test: `packages/dashboard/src/__tests__/router.test.ts`
- Test: `packages/dashboard/src/__tests__/api-client.test.ts`
- Test: `packages/dashboard/src/__tests__/poller.test.ts`

**Interfaces:**
- Consumes: Task 1 `ApiErrorResponse`（api-types）
- Produces（Task 8 页面消费）:
  - `matchRoute(pattern: string, path: string): Record<string, string> | null`；`parseHash(hash: string): string`；`resolvePage(path: string): { page: PageId; params: Record<string, string> }`；`type PageId = 'overview' | 'runs' | 'run' | 'requests' | 'request' | 'fields' | 'ignored' | 'not-found'`
  - `useHashRoute(): { path: string; page: PageId; params: Record<string, string> }`；`navigate(to: string): void`
  - `class ApiError extends Error { status: number; body: unknown; get hint(): string | undefined }`；`getJson<T>(path: string, fetchImpl?: typeof fetch): Promise<T>`
  - `POLL_INTERVAL_MS = 5000`；`class Poller { constructor(path, opts: PollerOptions); start(): void; refresh(): Promise<void>; stop(): void }`，`PollerOptions = { intervalMs?: number; fetchImpl?: typeof fetch; onUpdate: (data: unknown) => void; onError: (err: unknown) => void }`
  - `usePolling<T>(path: string | null): { data: T | null; error: unknown; refresh: () => void }`

- [ ] **Step 1: 写失败测试（三个文件）**

  `packages/dashboard/src/__tests__/router.test.ts`：

  ```ts
  import { describe, it, expect } from 'vitest'
  import { matchRoute, parseHash, resolvePage } from '../ui/router'

  describe('matchRoute', () => {
    it('literal segments must equal', () => {
      expect(matchRoute('/runs', '/runs')).toEqual({})
      expect(matchRoute('/runs', '/fields')).toBeNull()
    })
    it(':param extracts + decodes', () => {
      expect(matchRoute('/runs/:runId/fields', '/runs/run_a/fields')).toEqual({ runId: 'run_a' })
      expect(matchRoute('/runs/:runId', '/runs/run%20a')).toEqual({ runId: 'run a' })
    })
    it('segment count mismatch → null', () => {
      expect(matchRoute('/runs/:runId', '/runs/a/fields')).toBeNull()
    })
  })

  describe('parseHash', () => {
    it('strips # and query; empty → /', () => {
      expect(parseHash('#/runs/run_a?x=1')).toBe('/runs/run_a')
      expect(parseHash('')).toBe('/')
      expect(parseHash('#/')).toBe('/')
    })
  })

  describe('resolvePage', () => {
    it('matches route table', () => {
      expect(resolvePage('/')).toEqual({ page: 'overview', params: {} })
      expect(resolvePage('/runs')).toEqual({ page: 'runs', params: {} })
      expect(resolvePage('/runs/run_a')).toEqual({ page: 'run', params: { runId: 'run_a' } })
      expect(resolvePage('/runs/run_a/requests/req_1')).toEqual({ page: 'request', params: { runId: 'run_a', requestId: 'req_1' } })
      expect(resolvePage('/runs/run_a/fields')).toEqual({ page: 'fields', params: { runId: 'run_a' } })
      expect(resolvePage('/runs/run_a/ignored')).toEqual({ page: 'ignored', params: { runId: 'run_a' } })
    })
    it('unknown → not-found', () => {
      expect(resolvePage('/nope')).toEqual({ page: 'not-found', params: {} })
    })
  })
  ```

  `packages/dashboard/src/__tests__/api-client.test.ts`：

  ```ts
  import { describe, it, expect } from 'vitest'
  import { getJson, ApiError } from '../ui/api'

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status })

  it('200 → parsed body', async () => {
    const data = await getJson<{ a: number }>('/api/x', async () => jsonResponse({ a: 1 }))
    expect(data).toEqual({ a: 1 })
  })

  it('404 with hint body → ApiError carries hint', async () => {
    const promise = getJson('/api/x', async () => jsonResponse({ error: 'unknown run', hint: 're-run' }, 404))
    await expect(promise).rejects.toMatchObject({ status: 404, hint: 're-run' })
  })

  it('500 with non-json body → ApiError, hint undefined', async () => {
    const err = await getJson('/api/x', async () => new Response('oops', { status: 500 })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).hint).toBeUndefined()
  })

  it('network failure → original error', async () => {
    await expect(
      getJson('/api/x', async () => { throw new Error('ECONNREFUSED') }),
    ).rejects.toThrow('ECONNREFUSED')
  })
  ```

  `packages/dashboard/src/__tests__/poller.test.ts`：

  ```ts
  import { describe, it, expect, vi, afterEach } from 'vitest'
  import { Poller, POLL_INTERVAL_MS } from '../ui/poller'

  afterEach(() => vi.useRealTimers())

  const okResponse = (): Response => new Response(JSON.stringify({ ok: 1 }), { status: 200 })

  it('default interval is 5000', () => {
    expect(POLL_INTERVAL_MS).toBe(5000)
  })

  it('fetches immediately then on interval', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => okResponse())
    const onUpdate = vi.fn()
    new Poller('/api/x', { fetchImpl, onUpdate, onError: () => {} }).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ ok: 1 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stop() halts polling and aborts inflight', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => okResponse())
    const poller = new Poller('/api/x', { fetchImpl, onUpdate: () => {}, onError: () => {} })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.stop()
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('errors keep polling（503 busy 自愈，spec §4）', async () => {
    vi.useFakeTimers()
    let fail = true
    const fetchImpl = vi.fn(async () => {
      if (fail) return new Response(JSON.stringify({ error: 'busy' }), { status: 503 })
      return okResponse()
    })
    const onError = vi.fn()
    const onUpdate = vi.fn()
    new Poller('/api/x', { fetchImpl, onUpdate, onError, intervalMs: 10 }).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledTimes(1)
    fail = false
    await vi.advanceTimersByTimeAsync(10)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
  ```

- [ ] **Step 2: 跑测试确认失败**

  Run: `npx vitest run packages/dashboard/src/__tests__/router.test.ts packages/dashboard/src/__tests__/api-client.test.ts packages/dashboard/src/__tests__/poller.test.ts`
  Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

  `packages/dashboard/src/ui/router.tsx`（UI 源码相对导入无后缀——vite 惯例，见 Global Constraints）：

  ```tsx
  /**
   * 手写 hash router（spec §3.4）：纯函数匹配逻辑（matchRoute/parseHash/resolvePage）
   * 与 React 薄包装（useHashRoute/navigate）分离——纯函数可测，hook 不含逻辑。
   * 路由表即页面清单；页面路径全在 #/ 之后，server 永远只见 /。
   */
  import { useEffect, useState } from 'react'

  export type PageId =
    | 'overview' | 'runs' | 'run' | 'requests' | 'request' | 'fields' | 'ignored' | 'not-found'

  export const ROUTES: { pattern: string; page: PageId }[] = [
    { pattern: '/', page: 'overview' },
    { pattern: '/runs', page: 'runs' },
    { pattern: '/runs/:runId', page: 'run' },
    { pattern: '/runs/:runId/requests', page: 'requests' },
    { pattern: '/runs/:runId/requests/:requestId', page: 'request' },
    { pattern: '/runs/:runId/fields', page: 'fields' },
    { pattern: '/runs/:runId/ignored', page: 'ignored' },
  ]

  /** 段数相等 + 字面段全等 + :param 提取（decodeURIComponent） */
  export function matchRoute(pattern: string, path: string): Record<string, string> | null {
    const pp = pattern.split('/').filter(Boolean)
    const sp = path.split('/').filter(Boolean)
    if (pp.length !== sp.length) return null
    const params: Record<string, string> = {}
    for (let i = 0; i < pp.length; i++) {
      const seg = pp[i]!
      const actual = sp[i]!
      if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(actual)
      else if (seg !== actual) return null
    }
    return params
  }

  /** '#/runs/x?q=1' → '/runs/x'；空 → '/' */
  export function parseHash(hash: string): string {
    const h = hash.startsWith('#') ? hash.slice(1) : hash
    const path = h.split('?')[0] ?? ''
    return path === '' ? '/' : path
  }

  export function resolvePage(path: string): { page: PageId; params: Record<string, string> } {
    for (const r of ROUTES) {
      const params = matchRoute(r.pattern, path)
      if (params !== null) return { page: r.page, params }
    }
    return { page: 'not-found', params: {} }
  }

  export function useHashRoute(): { path: string; page: PageId; params: Record<string, string> } {
    const [hash, setHash] = useState(() => window.location.hash)
    useEffect(() => {
      const onChange = (): void => setHash(window.location.hash)
      window.addEventListener('hashchange', onChange)
      return () => window.removeEventListener('hashchange', onChange)
    }, [])
    const path = parseHash(hash)
    const resolved = resolvePage(path)
    return { path, page: resolved.page, params: resolved.params }
  }

  export function navigate(to: string): void {
    window.location.hash = to
  }
  ```

  `packages/dashboard/src/ui/api.ts`：

  ```ts
  /**
   * API 客户端（spec §3.4）：getJson 纯 fetch 包装 + ApiError 携带服务端 hint。
   * 错误态由 usePolling 捕获后交给页面渲染（404 空态 / 503 重试提示）。
   */
  import type { ApiErrorResponse } from '../shared/api-types.js'

  export class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly body: unknown,
    ) {
      super(`API ${status}`)
      this.name = 'ApiError'
    }

    get hint(): string | undefined {
      return (this.body as ApiErrorResponse | null)?.hint
    }

    get serverError(): string | undefined {
      return (this.body as ApiErrorResponse | null)?.error
    }
  }

  export async function getJson<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
    const res = await fetchImpl(path)
    if (!res.ok) {
      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        // 空/非 JSON body 容忍——hint 缺省
      }
      throw new ApiError(res.status, body)
    }
    return (await res.json()) as T
  }
  ```

  `packages/dashboard/src/ui/poller.ts`：

  ```ts
  /**
   * 轮询器（spec §3.4 纯逻辑件，React hook 是薄包装）：
   * start 立即拉一次 + setInterval；refresh 手动触发；stop 清理并 abort 在飞请求。
   * 错误不终止轮询（503 busy / 网络抖动由 UI 轮询自愈，spec §4）。
   */
  import { ApiError } from './api'

  export const POLL_INTERVAL_MS = 5000

  export interface PollerOptions {
    intervalMs?: number
    fetchImpl?: typeof fetch
    onUpdate: (data: unknown) => void
    onError: (err: unknown) => void
  }

  export class Poller {
    private timer: ReturnType<typeof setInterval> | null = null
    private inflight: AbortController | null = null

    constructor(
      private readonly path: string,
      private readonly opts: PollerOptions,
    ) {}

    start(): void {
      void this.refresh()
      this.timer = setInterval(() => void this.refresh(), this.opts.intervalMs ?? POLL_INTERVAL_MS)
    }

    async refresh(): Promise<void> {
      this.inflight?.abort()
      const controller = new AbortController()
      this.inflight = controller
      try {
        const res = await (this.opts.fetchImpl ?? fetch)(this.path, { signal: controller.signal })
        if (!res.ok) {
          let body: unknown = null
          try {
            body = await res.json()
          } catch {
            // 空 body 容忍
          }
          this.opts.onError(new ApiError(res.status, body))
          return
        }
        this.opts.onUpdate(await res.json())
      } catch (err) {
        if (controller.signal.aborted) return // 被 stop/新 refresh 取代，不报错
        this.opts.onError(err)
      } finally {
        if (this.inflight === controller) this.inflight = null
      }
    }

    stop(): void {
      if (this.timer !== null) clearInterval(this.timer)
      this.timer = null
      this.inflight?.abort()
      this.inflight = null
    }
  }
  ```

  `packages/dashboard/src/ui/hooks.ts`：

  ```tsx
  /**
   * React 薄包装：usePolling 把 Poller 状态接进组件树。
   * path 为 null 时不启动（Overview 的两段式拉取：先 runs 后 metrics）。
   */
  import { useEffect, useRef, useState } from 'react'
  import { Poller } from './poller'

  export interface PollingState<T> {
    data: T | null
    error: unknown
  }

  export function usePolling<T>(path: string | null): PollingState<T> & { refresh: () => void } {
    const [state, setState] = useState<PollingState<T>>({ data: null, error: null })
    const pollerRef = useRef<Poller | null>(null)
    useEffect(() => {
      if (path === null) return
      const poller = new Poller(path, {
        onUpdate: (data) => setState({ data: data as T, error: null }),
        onError: (err) => setState((prev) => ({ data: prev.data, error: err })),
      })
      pollerRef.current = poller
      poller.start()
      return () => {
        poller.stop()
        pollerRef.current = null
      }
    }, [path])
    return { ...state, refresh: () => void pollerRef.current?.refresh() }
  }
  ```

- [ ] **Step 4: 跑测试确认通过**

  Run: `corepack pnpm --filter @nx-mk/dashboard test` → 全绿（新增 16 用例）
  Run: `corepack pnpm --filter @nx-mk/dashboard typecheck` → 绿（tsx/jsx 编译过 tsc）

- [ ] **Step 5: 提交**

  ```bash
  git add packages/dashboard/src
  git commit -m "feat(dashboard): UI 纯逻辑 —— hash router / 轮询 / api client"
  ```

---

### Task 8: UI 页面 + App 装配 + vite 构建流

**Files:**
- Create: `packages/dashboard/src/ui/App.tsx`
- Create: `packages/dashboard/src/ui/main.tsx`
- Create: `packages/dashboard/src/ui/styles.css`
- Create: `packages/dashboard/src/ui/pages/Overview.tsx`
- Create: `packages/dashboard/src/ui/pages/RunsList.tsx`
- Create: `packages/dashboard/src/ui/pages/RunOverview.tsx`
- Create: `packages/dashboard/src/ui/pages/RequestsList.tsx`
- Create: `packages/dashboard/src/ui/pages/RequestDetail.tsx`
- Create: `packages/dashboard/src/ui/pages/FieldsList.tsx`
- Create: `packages/dashboard/src/ui/pages/IgnoredList.tsx`
- Modify: `packages/dashboard/package.json`（build 脚本扩为 `tsup && vite build`，+`build:ui`）

**Interfaces:**
- Consumes: Task 7 全部（router/hooks/api）、Task 1 api-types 全部响应类型、Task 4 的 7 条路由契约
- Produces: 可构建 UI（`vite build` → dist-ui/）；`App` 组件（main.tsx 挂载）。页面按 hash 分发：`/`→Overview、`/runs`→RunsList、`/runs/:runId`→RunOverview、`/runs/:runId/requests`→RequestsList、`.../requests/:requestId`→RequestDetail、`/runs/:runId/fields`→FieldsList、`/runs/:runId/ignored`→IgnoredList

- [ ] **Step 1: 写 App + main + styles**

  `packages/dashboard/src/ui/App.tsx`：

  ```tsx
  /**
   * App —— hash 路由分发 + 顶部导航（spec §3.4）。
   * 页面组件只做「usePolling 拉数 → 渲染」，逻辑全部在已测的 router/poller/api。
   */
  import { useHashRoute } from './router'
  import { OverviewPage } from './pages/Overview'
  import { RunsListPage } from './pages/RunsList'
  import { RunOverviewPage } from './pages/RunOverview'
  import { RequestsListPage } from './pages/RequestsList'
  import { RequestDetailPage } from './pages/RequestDetail'
  import { FieldsListPage } from './pages/FieldsList'
  import { IgnoredListPage } from './pages/IgnoredList'

  export function App() {
    const { page, params } = useHashRoute()
    return (
      <>
        <nav>
          <a href="#/">Overview</a>
          <a href="#/runs">Runs</a>
        </nav>
        <main>
          {page === 'overview' && <OverviewPage />}
          {page === 'runs' && <RunsListPage />}
          {page === 'run' && <RunOverviewPage runId={params.runId ?? ''} />}
          {page === 'requests' && <RequestsListPage runId={params.runId ?? ''} />}
          {page === 'request' && (
            <RequestDetailPage runId={params.runId ?? ''} requestId={params.requestId ?? ''} />
          )}
          {page === 'fields' && <FieldsListPage runId={params.runId ?? ''} />}
          {page === 'ignored' && <IgnoredListPage runId={params.runId ?? ''} />}
          {page === 'not-found' && <p className="empty">Not found — pick a page above.</p>}
        </main>
      </>
    )
  }
  ```

  `packages/dashboard/src/ui/main.tsx`：

  ```tsx
  import { createRoot } from 'react-dom/client'
  import { App } from './App'
  import './styles.css'

  createRoot(document.getElementById('root')!).render(<App />)
  ```

  `packages/dashboard/src/ui/styles.css`：

  ```css
  /* nx-mk dashboard —— 单份手写样式（spec §2.1）；本地分析台，浅色为主 */
  :root {
    --border: #ddd;
    --muted: #777;
    --warn: #b45309;
    --bad: #b91c1c;
    --ok: #15803d;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; color: #111; background: #fafafa; }
  nav { display: flex; gap: 16px; padding: 10px 20px; border-bottom: 1px solid var(--border); background: #fff; }
  nav a { color: #1d4ed8; text-decoration: none; font-weight: 600; }
  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  td a { color: #1d4ed8; }
  .cards { display: flex; gap: 16px; margin: 16px 0; flex-wrap: wrap; }
  .card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 16px 24px; min-width: 160px; }
  .card .num { font-size: 32px; font-weight: 700; }
  .card .label { color: var(--muted); }
  .badge { display: inline-block; border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; margin: 0 8px 8px 0; background: #fff; }
  .badge.warn { color: var(--warn); border-color: var(--warn); }
  .badge.bad { color: var(--bad); border-color: var(--bad); }
  .badge.ok { color: var(--ok); border-color: var(--ok); }
  .muted { color: var(--muted); font-weight: 400; }
  .empty { color: var(--muted); font-style: italic; }
  .error { color: var(--bad); }
  details { margin: 2px 0; }
  summary { cursor: pointer; }
  pre { background: #f3f4f6; padding: 8px; overflow-x: auto; max-width: 100%; }
  .counts { margin: 12px 0; }
  .section { margin-top: 24px; }
  ```

- [ ] **Step 2: 写七个页面组件**

  `packages/dashboard/src/ui/pages/Overview.tsx`：

  ```tsx
  /** / —— 最新 run 总览（spec §3.4）：三指标大数字 + 计数徽章 + goal 终止原因 */
  import { usePolling } from '../hooks'
  import type { RunsListResponse, MetricsResponse } from '../../shared/api-types'

  function pct(n: number): string {
    return `${Math.round(n * 100)}%`
  }

  export function OverviewPage() {
    const runs = usePolling<RunsListResponse>('/api/runs')
    const latest = runs.data?.runs.find((r) => r.hasReport) ?? null
    const metrics = usePolling<MetricsResponse>(latest ? `/api/runs/${latest.runId}/metrics` : null)
    if (runs.error !== null && runs.data === null) return <p className="error">failed to load runs</p>
    if (!runs.data) return <p>loading…</p>
    if (runs.data.runs.length === 0) {
      return <p className="empty">No runs yet — run <code>nx-mk run</code> first.</p>
    }
    const m = metrics.data?.metrics
    return (
      <section>
        <h1>
          Overview {latest !== null ? <span className="muted">({latest.runId})</span> : null}
        </h1>
        {latest?.terminatedBy != null && <span className="badge ok">terminated: {latest.terminatedBy}</span>}
        {m !== undefined ? (
          <div className="cards">
            <div className="card"><div className="num">{pct(m.requiredCoverage)}</div><div className="label">required</div></div>
            <div className="card"><div className="num">{pct(m.effectiveCoverage)}</div><div className="label">effective</div></div>
            <div className="card"><div className="num">{pct(m.rawBackendFieldCoverage)}</div><div className="label">raw backend</div></div>
          </div>
        ) : (
          <p className="empty">No coverage report yet — it is written when a run finishes.</p>
        )}
        {m !== undefined && (
          <div className="counts">
            <span className="badge warn">missing required: {m.missingRequiredFields}</span>
            <span className="badge">ignored returned: {m.ignoredReturnedFields}</span>
            <span className="badge">suspicious: {m.suspiciousFields}</span>
            <span className="badge">endpoints: {m.endpointsCalled}/{m.endpointsTotal}</span>
          </div>
        )}
      </section>
    )
  }
  ```

  `packages/dashboard/src/ui/pages/RunsList.tsx`：

  ```tsx
  /** /runs —— 历史运行列表（spec §3.4） */
  import { usePolling } from '../hooks'
  import type { RunsListResponse } from '../../shared/api-types'

  export function RunsListPage() {
    const { data } = usePolling<RunsListResponse>('/api/runs')
    if (!data) return <p>loading…</p>
    return (
      <section>
        <h1>Runs</h1>
        {data.runs.length === 0 ? (
          <p className="empty">No runs yet — run <code>nx-mk run</code> first.</p>
        ) : (
          <table>
            <thead>
              <tr><th>run</th><th>status</th><th>started</th><th>ended</th><th>terminated</th><th>report</th></tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.runId}>
                  <td><a href={`#/runs/${r.runId}`}>{r.runId}</a></td>
                  <td>{r.status ?? '—'}</td>
                  <td>{r.startedAt ?? '—'}</td>
                  <td>{r.endedAt ?? '—'}</td>
                  <td>{r.terminatedBy ?? '—'}</td>
                  <td>{r.hasReport ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    )
  }
  ```

  `packages/dashboard/src/ui/pages/RunOverview.tsx`：

  ```tsx
  /** /runs/:runId —— 单 run 报告总览：三指标 + 四清单计数 + endpoints 比例 */
  import { ApiError } from '../api'
  import { usePolling } from '../hooks'
  import type { MetricsResponse, RunDetailResponse } from '../../shared/api-types'

  export function RunOverviewPage({ runId }: { runId: string }) {
    const detail = usePolling<RunDetailResponse>(`/api/runs/${runId}`)
    const metrics = usePolling<MetricsResponse>(`/api/runs/${runId}/metrics`)
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return <p className="empty">Run not found: {runId}</p>
    }
    if (!detail.data) return <p>loading…</p>
    const m = metrics.error instanceof ApiError ? undefined : metrics.data?.metrics
    return (
      <section>
        <h1>{runId}</h1>
        {detail.data.terminatedBy != null && <span className="badge ok">terminated: {detail.data.terminatedBy}</span>}
        {m !== undefined ? (
          <>
            <div className="cards">
              <div className="card"><div className="num">{Math.round(m.requiredCoverage * 100)}%</div><div className="label">required</div></div>
              <div className="card"><div className="num">{Math.round(m.effectiveCoverage * 100)}%</div><div className="label">effective</div></div>
              <div className="card"><div className="num">{Math.round(m.rawBackendFieldCoverage * 100)}%</div><div className="label">raw backend</div></div>
            </div>
            <div className="counts">
              <a className="badge warn" href={`#/runs/${runId}/fields`}>missing required: {m.missingRequiredFields}</a>
              <a className="badge" href={`#/runs/${runId}/ignored`}>ignored returned: {m.ignoredReturnedFields}</a>
              <a className="badge" href={`#/runs/${runId}/fields`}>suspicious: {m.suspiciousFields}</a>
              <span className="badge">endpoints: {m.endpointsCalled}/{m.endpointsTotal}</span>
              <span className="badge">fields returned: {m.fieldsReturned}/{m.fieldsTotal}</span>
            </div>
          </>
        ) : (
          <p className="empty">
            No coverage report for this run (report is overwritten by the latest run).
            Requests and fields remain available below.
          </p>
        )}
        <div className="section">
          <a href={`#/runs/${runId}/requests`}>Requests →</a>
          {'　'}
          <a href={`#/runs/${runId}/fields`}>Fields →</a>
          {'　'}
          <a href={`#/runs/${runId}/ignored`}>Ignored →</a>
        </div>
      </section>
    )
  }
  ```

  `packages/dashboard/src/ui/pages/RequestsList.tsx`：

  ```tsx
  /** /runs/:runId/requests —— 请求列表（report.requests 或 db 投影） */
  import { ApiError } from '../api'
  import { usePolling } from '../hooks'
  import type { RequestsListResponse } from '../../shared/api-types'

  export function RequestsListPage({ runId }: { runId: string }) {
    const { data, error } = usePolling<RequestsListResponse>(`/api/runs/${runId}/requests`)
    if (error instanceof ApiError && error.status === 404) return <p className="empty">Run not found: {runId}</p>
    if (!data) return <p>loading…</p>
    return (
      <section>
        <h1>Requests <span className="muted">({runId})</span></h1>
        {data.requests.length === 0 ? (
          <p className="empty">No requests captured in this run.</p>
        ) : (
          <table>
            <thead>
              <tr><th>method</th><th>path / url</th><th>status</th><th>duration</th><th>started</th></tr>
            </thead>
            <tbody>
              {data.requests.map((r, i) => (
                <tr key={r.requestId ?? i}>
                  <td>{r.method ?? '—'}</td>
                  <td>
                    {r.requestId != null
                      ? <a href={`#/runs/${runId}/requests/${r.requestId}`}>{r.path ?? r.url ?? r.requestId}</a>
                      : (r.path ?? r.url ?? '—')}
                  </td>
                  <td>{r.status ?? '—'}</td>
                  <td>{r.durationMs != null ? `${r.durationMs}ms` : '—'}</td>
                  <td>{r.startedAt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    )
  }
  ```

  `packages/dashboard/src/ui/pages/RequestDetail.tsx`：

  ```tsx
  /**
   * /runs/:runId/requests/:requestId —— 请求详情三段（spec §3.4）：
   * trace / 关联 hits / 关联 evidence；空关联显示 "not associated"（v0 数据现实）。
   */
  import { ApiError } from '../api'
  import { usePolling } from '../hooks'
  import type { RequestDetailResponse } from '../../shared/api-types'

  export function RequestDetailPage({ runId, requestId }: { runId: string; requestId: string }) {
    const { data, error } = usePolling<RequestDetailResponse>(`/api/runs/${runId}/requests/${requestId}`)
    if (error instanceof ApiError && error.status === 404) {
      return <p className="empty">Request not found: {requestId}</p>
    }
    if (!data) return <p>loading…</p>
    const t = data.trace
    return (
      <section>
        <h1>{t.method} {t.path ?? t.url}</h1>
        <p>
          <a href={`#/runs/${runId}/requests`}>← Requests</a>
        </p>
        <table>
          <tbody>
            <tr><th>url</th><td>{t.url}</td></tr>
            <tr><th>status</th><td>{t.status ?? '—'}</td></tr>
            <tr><th>duration</th><td>{t.durationMs != null ? `${t.durationMs}ms` : '—'}</td></tr>
            <tr><th>endpoint</th><td>{t.endpointId ?? '—'}</td></tr>
            <tr><th>started</th><td>{t.startedAt ?? '—'}</td></tr>
          </tbody>
        </table>
        <div className="section">
          <h2>Field hits</h2>
          {data.hits.length === 0 ? (
            <p className="empty">not associated</p>
          ) : (
            <table>
              <thead><tr><th>field</th><th>count</th><th>source</th><th>last hit</th></tr></thead>
              <tbody>
                {data.hits.map((h) => (
                  <tr key={h.id}>
                    <td>{h.normalizedPath}</td>
                    <td>{h.count}</td>
                    <td>{h.source ?? '—'}</td>
                    <td>{h.lastHitAt ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="section">
          <h2>UI evidence</h2>
          {data.evidence.length === 0 ? (
            <p className="empty">not associated</p>
          ) : (
            <table>
              <thead><tr><th>field</th><th>visible</th><th>text sample</th><th>selector</th></tr></thead>
              <tbody>
                {data.evidence.map((e) => (
                  <tr key={e.id}>
                    <td>{e.fieldPath}</td>
                    <td>{e.visible === 1 ? 'yes' : 'no'}</td>
                    <td>{e.textSample != null ? <pre>{e.textSample}</pre> : '—'}</td>
                    <td>{e.selector ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    )
  }
  ```

  `packages/dashboard/src/ui/pages/FieldsList.tsx`：

  ```tsx
  /**
   * /runs/:runId/fields —— 四态分组列表（spec §3.4）：
   * 行内展开 policyStatus/hitCount/matchedRule/accessHit/uiHit
   * （evidence 的 textSample 展示在 RequestDetail——7 条路由契约不含 per-field evidence 查询）。
   */
  import { ApiError } from '../api'
  import { usePolling } from '../hooks'
  import type { EnrichedCoverageFieldRow, FieldsListResponse } from '../../shared/api-types'

  const STATES = ['covered', 'missing', 'ignored', 'notApplicable'] as const
  const STATE_LABEL: Record<(typeof STATES)[number], string> = {
    covered: 'Covered',
    missing: 'Missing (required)',
    ignored: 'Ignored',
    notApplicable: 'Not applicable',
  }

  export function FieldsListPage({ runId }: { runId: string }) {
    const { data, error } = usePolling<FieldsListResponse>(`/api/runs/${runId}/fields`)
    if (error instanceof ApiError && error.status === 404) return <p className="empty">Run not found: {runId}</p>
    if (!data) return <p>loading…</p>
    if (data.fields.length === 0) {
      return (
        <section>
          <h1>Fields <span className="muted">({runId})</span></h1>
          <p className="empty">No coverage_fields rows for this run — run with <code>collect:</code> config to populate.</p>
        </section>
      )
    }
    return (
      <section>
        <h1>Fields <span className="muted">({runId})</span></h1>
        {STATES.map((state) => {
          const rows = data.fields.filter((f) => f.coverageState === state)
          if (rows.length === 0) return null
          return (
            <div className="section" key={state}>
              <h2>{STATE_LABEL[state]} <span className="muted">({rows.length})</span></h2>
              <table>
                <thead><tr><th>field</th><th>policy</th><th>access/ui</th><th>details</th></tr></thead>
                <tbody>
                  {rows.map((f) => <FieldRow key={f.id} f={f} />)}
                </tbody>
              </table>
            </div>
          )
        })}
      </section>
    )
  }

  function FieldRow({ f }: { f: EnrichedCoverageFieldRow }) {
    return (
      <tr>
        <td>{f.fieldPath}</td>
        <td>{f.policyStatus}</td>
        <td>{f.accessHit === 1 ? 'access' : ''}{f.accessHit === 1 && f.uiHit === 1 ? ' + ' : ''}{f.uiHit === 1 ? 'ui' : ''}</td>
        <td>
          <details>
            <summary className="muted">details</summary>
            <div>
              {f.hitCount !== undefined && <p>hit count: {f.hitCount}</p>}
              {f.matchedRule !== undefined && (
                <p>
                  rule: <code>{f.matchedRule.pattern}</code> ({f.matchedRule.source})
                  {f.matchedRule.reason != null ? ` — ${f.matchedRule.reason}` : ''}
                </p>
              )}
              <p className="muted">counted: required={f.countedRequired ?? '—'} effective={f.countedEffective ?? '—'}</p>
            </div>
          </details>
        </td>
      </tr>
    )
  }
  ```

  `packages/dashboard/src/ui/pages/IgnoredList.tsx`：

  ```tsx
  /** /runs/:runId/ignored —— Returned but ignored 清单（spec §3.4） */
  import { ApiError } from '../api'
  import { usePolling } from '../hooks'
  import type { IgnoredListResponse } from '../../shared/api-types'

  export function IgnoredListPage({ runId }: { runId: string }) {
    const { data, error } = usePolling<IgnoredListResponse>(`/api/runs/${runId}/ignored`)
    if (error instanceof ApiError && error.status === 404) {
      return <p className="empty">No coverage report for this run (overwritten by the latest run).</p>
    }
    if (!data) return <p>loading…</p>
    return (
      <section>
        <h1>Returned but ignored <span className="muted">({runId})</span></h1>
        {data.ignored.length === 0 ? (
          <p className="empty">Nothing ignored-and-returned in this run.</p>
        ) : (
          <table>
            <thead><tr><th>field</th><th>hit count</th><th>matched rule</th></tr></thead>
            <tbody>
              {data.ignored.map((f) => (
                <tr key={f.fieldId}>
                  <td>{f.fieldPath}</td>
                  <td>{f.hitCount ?? '—'}</td>
                  <td>{f.matchedRule != null ? <code>{f.matchedRule.pattern}</code> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    )
  }
  ```

- [ ] **Step 3: 扩构建脚本**

  `packages/dashboard/package.json` scripts 改为：

  ```json
  "build": "tsup && vite build",
  "build:server": "tsup",
  "build:ui": "vite build",
  ```

- [ ] **Step 4: 验证**

  Run: `corepack pnpm --filter @nx-mk/dashboard typecheck` → 绿（tsx 全量过 tsc）
  Run: `corepack pnpm --filter @nx-mk/dashboard build` → 成功；`ls packages/dashboard/dist-ui` 含 `index.html` 与 `assets/`
  Run: `npx vitest run packages/dashboard` → 全绿（UI 无浏览器级测试，组件薄 + 逻辑已测）

- [ ] **Step 5: 提交**

  ```bash
  git add packages/dashboard
  git commit -m "feat(dashboard): 7 页只读界面 + vite 构建流"
  ```

---

### Task 9: demo 接线 + README + 全量验收

**Files:**
- Modify: `examples/react-vite-demo/nx-mk.config.yml`（+dashboard 段）
- Modify: `README.md`（+Dashboard 使用段）

**Interfaces:**
- Consumes: Task 5 `dashboard` 配置段、Task 6 `nx-mk start`
- Produces: demo 手动验收路径（spec §1.4.1）+ 文档

- [ ] **Step 1: demo config 加 dashboard 段**

  `examples/react-vite-demo/nx-mk.config.yml` 在 `coverage:` 段后追加：

  ```yaml
  # Phase 4 Dashboard（spec §3.6）：`nx-mk start` 消费 —— 端口与自动开浏览器
  dashboard:
    port: 4317
    open: true
  ```

- [ ] **Step 2: README 加 Dashboard 使用段**

  在根 `README.md` 的 Phase 3 使用说明之后追加（位置随现有结构自然衔接）：

  ````markdown
  ## Dashboard（Phase 4）

  ```bash
  cd examples/react-vite-demo
  node ../../packages/cli/dist/index.js start
  ```

  - 默认 `http://127.0.0.1:4317`（`--port` 覆盖；config `dashboard.port` / `dashboard.open` 可配）
  - 先起 server 再自动跑一次分析（`--no-run` 只看已有产物）；run 失败 server 不关，failed run 可见
  - 页面：Overview（最新 run 三指标）/ Runs / run 总览 / Requests 列表+详情（含 field hits 与 UI evidence 文本样本）/ Fields 四态列表 / Returned-but-ignored
  - 数据全部只读自 `.nx-mk/`（coverage.db readonly + coverage-report.json + runs 目录）；UI 每 5 秒轮询，运行中的 run 完成后数据自动出现
  ````

- [ ] **Step 3: 全量验证**

  Run: `npx vitest run` → 全绿（预期 330 → ~385±15）
  Run: `corepack pnpm run demo:typecheck` → 绿（demo config 新增 dashboard 段过 schema——注意 demo:typecheck 不加载 nx-mk.config.yml，此项验证的是 app/server 类型；config 加载已由 Task 5 测试覆盖）
  Run: `corepack pnpm -r build` → 全包构建绿（含 dashboard tsup+vite）

- [ ] **Step 4: demo 手动验收（记录步骤，供人工执行）**

  验收清单（写入报告，不由实现器执行浏览器操作）：

  1. demo 后端 + vite 前端起跑（README 既有步骤）
  2. `node ../../packages/cli/dist/index.js start` → 控制台打印 `✔ Dashboard: http://127.0.0.1:4317`，浏览器自动打开
  3. Overview 显示三指标（required 100% / effective 100% / raw backend ~36%）
  4. Runs 页可见历史 run + 本次 run（terminated: goal-met）
  5. Requests → 详情可见 field hits 与 evidence 文本样本；Fields 页四态分组；Ignored 页 1 条 internalRiskScore
  6. 另开终端复跑 `nx-mk run` → Dashboard 5s 内出现新 run 行

- [ ] **Step 5: 提交**

  ```bash
  git add examples/react-vite-demo/nx-mk.config.yml README.md
  git commit -m "feat(demo,docs): dashboard 接线 + README 使用段"
  ```

---

## Self-Review 记录（控制器执行，不进入任务）

1. **Spec coverage**：§1.2 七目标 → T0（DDL）、T1-T4（server/API）、T5（config）、T6（start）、T7-T8（UI）、T9（demo/README/验收）；§4 错误表 12 行 → T2（降级 null）、T3（null/busy）、T4（404/503/hint）、T6（EADDRINUSE/run 失败保活/openBrowser warn）、T5（CONFIG_INVALID）逐行有归属。无缺口。
2. **Placeholder 扫描**：所有代码块完整可落盘；无 TBD/"适当处理"。
3. **类型一致性**：`RouteContext.busyTimeoutMs`（T1 定义 → T3 openReader opts → T4 路由消费）一致；`reportForRun`（T2 产 → T4 metrics/requests/fields/ignored 消费）一致；`StartDeps`（T6 产 → T6 测试消费）一致；`EnrichedCoverageFieldRow`（T1 定义 → T4 富化 → T8 FieldsList 消费）一致；`PageId`（T7 产 → T8 App 分发）一致。
