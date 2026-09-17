# nx-mk Spec: Phase 4 — Dashboard（纯只读：runs/overview/requests/fields/ignored + nx-mk start）

> 日期：2026-09-17
> 范围：Phase 4 — 让 Phase 3 的 coverage 数据可视可查：只读 Dashboard（server + UI）、`nx-mk start` 一键命令、DDL 校对
> 不在范围：GET replay（§27 安全策略）、plugin settings / PATCH 写回（§31）、manifest 浏览器页、SSE /api/events 与 RunState 订阅（§15）、settings 编辑页、`dashboard.defaultView`、Phase 3 遗留 backlog 其余 12 项（见 §7 D8）
> 关联文档：
> - `docx/plan/nx-mk-plan.md`（§4 端口 4317、§5.2 Dashboard 职责、§8 Monorepo、§10 dashboard 配置段、§15 DashboardEvent/SSE、§25 SQLite DDL、§28.2 CoverageReport、§30 页面与 API 路由、§42 Phase 4 roadmap）
> - `docs/superpowers/specs/2026-09-17-nx-mk-phase3-analysis-design.md`（数据来源 — 本 spec 的消费契约）
> - PR #9 描述（Phase 3 终审 13 项 backlog 处置：仅 DDL 校对带入本期）

---

## 1. 目标与非目标

### 1.1 现状与缺口

Phase 3 交付了完整分析链路，但产物只有 stdout 三行摘要：

1. **数据已落盘但无界面**：`.nx-mk/coverage-report.json`（§28.2 契约）+ `coverage.db`（§25 九表）已可机读，人只能翻 JSON/SQLite
2. **无 `start` 命令**：plan §7/§9 的 `npx mk start`（一键 Dashboard + 分析）不存在；CLI 只有 run/init/doctor/migrate
3. **历史 run 不可比**：coverage.db runs 表已积累每次运行（含 terminated_by），无任何查看入口
4. **DDL 演进未校对**：Phase 3 以 `ensureColumn` 加了 `runs.terminated_by`、`ui_evidence.text_sample` 两列，与 §25 冻结 DDL 的一致性只在 spec 里声明过、未逐字核对（Dashboard 查询层写之前必须确认）

### 1.2 目标

本 spec 交付后：

1. **`nx-mk start` 一键可用**：起本地 server（默认 127.0.0.1:4317）→ 自动跑一次分析（`--no-run` 关闭）→ 浏览器打开 Dashboard；run 失败 server 不关，failed run 在页面可见
2. **五页只读 UI**：Overview（最新 run 三指标）/ runs 列表 / run 总览 / requests 列表+详情 / fields 四态列表（行内展开 evidence）/ ignored 清单
3. **7 条只读 API**（§30.2 子集）：runs、run、metrics、requests、request、fields、ignored——全部只读，零写路径
4. **轮询读盘架构**：server 全程只读 `.nx-mk/` 三来源（目录扫描 / readonly SQLite / report JSON），零内核参与；UI 5s 轮询 + 手动刷新
5. **边跑边看**：WAL 下 run 写入与 server 读取并发；进行中的 run 显示 `running` 状态行，数据于 run 完成时可见
6. **DDL 校对落档**：`SCHEMA_SQL` 九表逐字比对 plan §25.1-25.9 + 两处 ALTER 一致性，结论落 spec 附注/README，漂移处修正
7. **demo 手动验收**：examples/react-vite-demo 下 `nx-mk start` → 浏览器看到 Phase 3 实测数据（required 100% 等）

### 1.3 非目标

- GET replay 请求/场景、Replay 安全策略（§27 三分类）——Phase 4.5
- plugin settings 页与 `PATCH /api/plugins/:name/config` 写回 mk.config.yml（§31）——Phase 4.5
- SSE `/api/events`、RunState 订阅、DashboardEvent 推送（§15）——轮询架构下 API 路由不变，4.5 平滑升级
- manifest 浏览器页（`/runs/:runId/manifest`）——fields 页已含字段级信息，浏览器推 4.5
- 任何写路径：无 POST/PATCH/DELETE，无 config 编辑，无 db 写连接
- `dashboard.defaultView`（§10 只收 port/open 两个键）
- 历史旧 run 的三指标回算（report 覆盖写语义下仅最新 run 有 metrics；旧 run 的 fields/requests 从 db 可查——已知限制，4.5 可加 metrics-from-db）
- Phase 3 backlog 其余 12 项（unknown 分支测试、config cast、kernel.ts 行数等）——继续 parked

### 1.4 成功标准

1. demo 手动验收：examples/react-vite-demo `nx-mk start` → 控制台打印 `Dashboard: http://127.0.0.1:4317`，浏览器自动打开并显示 Phase 3 实测三指标；另开终端复跑 `nx-mk run`，Dashboard 轮询 5s 内出现新 run 行
2. 7 条 API 路由 fastify `inject()` 测试通过：正常 / 404 / 降级（db 缺失、report 缺失、`.nx-mk` 缺失）三态全覆盖
3. store 三来源单测：真 SQLite fixture（readonly 打开、busy 语义）、report 形状门控、目录扫描
4. start 命令测试：run 抛错 server 存活；`--no-run` 不触发；端口占用退出非零
5. UI 纯逻辑单测：hash router 模式匹配、usePolling（fake timers）、api 客户端（fetch stub）
6. 全部测试通过（当前 330 → 预计 +50±15）；`corepack pnpm run demo:typecheck` 绿
7. DDL 校对结论落档：九表逐字比对表 + 两处 ALTER 一致性确认（或修正）

---

## 2. 仓库架构

### 2.1 目录变化

```
packages/dashboard/                     # 新包（单包双构建目标，见 D4）
├── package.json                        # server: fastify + better-sqlite3；构建: vite/react（devDeps）
├── tsup.config.ts                      # server 构建到 dist/（entry: src/server/index.ts）
├── vite.config.ts                      # UI 构建到 dist-ui/（root: 包根，base './'）
├── index.html                          # vite 入口（引用 /src/ui/main.tsx）
└── src/
    ├── shared/
    │   └── api-types.ts                # API 响应形状（server 与 UI 共享，零拷贝）
    ├── server/
    │   ├── index.ts                    # buildServer(opts) → fastify 实例（/api + 静态）
    │   ├── static.ts                   # 手写静态托管（GET / → index.html；GET /assets/* → 文件）
    │   ├── store/
    │   │   ├── runs-store.ts           # .nx-mk/runs/* 目录扫描（runId 主键来源）
    │   │   ├── db-reader.ts            # better-sqlite3 readonly 打开 + busy_timeout + 查询封装
    │   │   ├── report-reader.ts        # coverage-report.json 形状门控读取
    │   │   └── queries.ts              # request_traces / field_hits / ui_evidence / coverage_fields / runs 查询（camelCase 投影）
    │   └── routes/
    │       ├── runs.ts                 # GET /api/runs, /api/runs/:runId
    │       ├── metrics.ts              # GET /api/runs/:runId/metrics
    │       ├── requests.ts             # GET /api/runs/:runId/requests, …/:requestId
    │       ├── fields.ts               # GET /api/runs/:runId/fields
    │       └── ignored.ts              # GET /api/runs/:runId/ignored
    └── ui/
        ├── main.tsx                    # createRoot 入口
        ├── router.tsx                  # 手写 hash router（模式表匹配 + useHashRoute hook）
        ├── api.ts                      # fetch 客户端 + usePolling(path, {intervalMs=5000}) hook
        ├── styles.css                  # 单份手写 CSS（表格/卡片/徽章）
        └── pages/
            ├── Overview.tsx            # /：最新 run 三指标 + 计数徽章
            ├── RunsList.tsx            # /runs
            ├── RunOverview.tsx         # /runs/:runId
            ├── RequestsList.tsx        # /runs/:runId/requests
            ├── RequestDetail.tsx       # /runs/:runId/requests/:requestId
            ├── FieldsList.tsx          # /runs/:runId/fields（四态分组 + 行内展开）
            └── IgnoredList.tsx         # /runs/:runId/ignored
packages/cli/src/
├── commands/start.ts                   # startMain(opts)：listen → 自动 run → catch 保活
└── index.ts                            # +start 子命令路由 + --port/--no-run flag 解析 + HELP
packages/config/src/schema.ts           # +DashboardConfigSchema { port?: int(1-65535), open?: boolean }
examples/react-vite-demo/nx-mk.config.yml  # +dashboard 段示例（port 4317, open: true）
README.md                               # +Dashboard 使用段（start 命令 + 页面导览）
tests/integration/
└── phase4-dashboard.test.ts            # buildServer + inject 全路由契约（真 SQLite fixture）
```

### 2.2 依赖变化

- **新增 runtime**：`fastify ^5`（server）；`better-sqlite3 ^11.10` **已在栈内**（Phase 2 为 @nx-mk/coverage 依赖），此处仅 dashboard 包新增直接声明——非新供应链面。server 直连 readonly；不复用 CoverageDb——那会建表/ALTER，违反只读
- **新增 build-time（dashboard devDeps）**：`react ^19`、`react-dom ^19`、`vite ^6`、`@vitejs/plugin-react ^4`、`@types/react`、`@types/react-dom`
- `@nx-mk/cli`：+`@nx-mk/dashboard` workspace:*
- **打破 Phase 1-3 零新增依赖纪律** —— 用户已批准的最小集（fastify/react/react-dom/vite/plugin-react 五项）；路由、CSS、静态托管、轮询均手写，不引 react-router / @fastify/static
- UI 打包后自含（react 进 bundle），dashboard 运行时面 = fastify + better-sqlite3 两个

---

## 3. 组件职责

### 3.1 store 读层（`src/server/store/`）

- **runs-store**：扫 `.nx-mk/runs/` 子目录 → runId 列表（目录是主键来源——非 collect run 也有目录无 db 行）；每 run 附 events.jsonl 存在性（manifest.json 是 workspace 级产物，不随 run——在 `/api/runs` 顶层以 `manifestAvailable` 报告）
- **db-reader**：`new Database(path, { readonly: true })` + `PRAGMA busy_timeout = 2000`；文件不存在/打开失败 → 返回 null（不抛）；每次查询包 try，SQLITE_BUSY → 上层映射 503。**绝不**跑 SCHEMA_SQL/ensureColumn
- **report-reader**：读 `.nx-mk/coverage-report.json` → 形状门控（object + `runId: string` + `metrics` 对象且三指标为 number；四数组缺省补 `[]`）→ 不合法返回 null（手法同 run.ts `isManifestShaped`）；**runId 匹配门控**：report 是最新 run 的覆盖写产物，`report.runId ≠ 查询目标 runId` 时调用方按缺失处理（旧 run 的 metrics/ignored → 404，requests → 回落 db 投影，见 D12）
- **queries**：camelCase 投影 §25 各表列——`TraceRow`（§25.4 列集）、`FieldHitRow`（§25.6）、`UiEvidenceRow`（§25.7 含 text_sample）、`CoverageFieldRow`（§25.8 十三列）、`RunRow`（§25.1 + terminated_by）。字段集 = 对应表列，不臆造
- 三来源独立降级（§4 表），调用方拿到 `{ runs, db, report }` 三态句柄

### 3.2 server 与路由（`src/server/`）

- `buildServer({ nxMkDir, uiDistDir })` → fastify 实例；logger 关闭（本地台，stdout 由 start 命令管）
- 7 条路由全部 `method: 'GET'`，响应形状见 §3.5；每路由文件 ≤400 行纪律
- 路由层只做编排（store 调用 + 状态码映射），业务判断在 store

### 3.3 静态托管（`src/server/static.ts`）

- `GET /` → uiDistDir/index.html；`GET /assets/*` → uiDistDir/assets/ 下文件（vite 产物带 hash 文件名）；Content-Type 按扩展名白名单（html/js/css/svg/map/json）
- **路径安全**：decodeURIComponent 后归一化，强制前缀 = assets root，含 `..`/绝对路径/越界 → 404（穿越用例测试锁定）
- hash 路由红利：页面路径都在 `#/` 后，server 永远只看到 `/`，无需 SPA history fallback

### 3.4 UI（`src/ui/`）

- **router**：模式表 `[{ pattern: '/runs/:runId/fields', page: FieldsList }, …]`；`useHashRoute()` 监听 hashchange，返回 `{ path, params }`；`navigate(to)` 写 `location.hash`
- **usePolling**：mount 时 fetch 一次 + setInterval（默认 5000ms）+ `refresh()`；unmount 清理 + AbortController；错误态显示后继续轮询
- **api**：`getJson<T>(path)` → 非 2xx 抛 `ApiError(status, hint)`；页面据此渲染 404 空态/降级提示
- **页面**：表格与卡片为纯展示组件；FieldsList 按 state 四组折叠，行内展开 policyStatus/hitCount/matchedRule/accessHit/uiHit（evidence 的 textSample 展示在 RequestDetail 页——7 条路由契约不含 per-field evidence 查询）；RequestDetail 三段（trace / 关联 hits / 关联 evidence，空关联显示 "not associated"——v0 数据现实，见 §8 风险）
- UI 文案英文（与 CLI stdout 惯例一致）；中文注释纪律不变

### 3.5 API 响应形状（§30.2 只读子集，完整契约在 `src/shared/api-types.ts`）

| 路由 | 响应 | 降级/404 |
|---|---|---|
| `GET /api/runs` | `{ runs: RunListItem[], manifestAvailable: boolean }`，RunListItem = `{ runId, hasEvents, hasReport, status?, startedAt?, endedAt?, terminatedBy? }` | `.nx-mk` 缺失 → `{runs:[], manifestAvailable:false}` |
| `GET /api/runs/:runId` | RunListItem + `{ dbRow?: RunRow }` | 未知 runId → 404 |
| `GET /api/runs/:runId/metrics` | `{ runId, status?, terminatedBy?, metrics: CoverageReportMetrics }` | report 缺失 → 404 + `hint: 'coverage-report.json is written at run end; re-run nx-mk run'` |
| `GET /api/runs/:runId/requests` | `{ requests: RequestTraceSummary[] }` | report 有 → report.requests；无 report → request_traces 按 run 投影；两者皆无 → `{requests:[]}` |
| `GET /api/runs/:runId/requests/:requestId` | `{ trace: TraceRow, hits: FieldHitRow[], evidence: UiEvidenceRow[] }`（hits/evidence 按 request_id 关联，可能为空数组） | requestId 于 traces 与 report 均无 → 404 |
| `GET /api/runs/:runId/fields` | `{ fields: Array<CoverageFieldRow & { hitCount?: number; matchedRule?: FieldCoverageItem['matchedRule'] }> }`（db 行为基座；report 命中该 run 时按 fieldPath 富化 hitCount/matchedRule——两值不在 §25.8 列中） | db/表缺失 → `{fields:[]}`（UI 空态） |
| `GET /api/runs/:runId/ignored` | `{ ignored: FieldCoverageItem[] }` | report 缺失 → 404 + 同 metrics hint |

RequestTraceSummary/FieldCoverageItem 复用 `@nx-mk/coverage` 导出（workspace 依赖）；db 行投影类型定义在 shared/api-types.ts。

### 3.6 `nx-mk start` 命令（`packages/cli/src/commands/start.ts`）

```
npx nx-mk start [--port <n>] [--no-run] [--config <path>]
```

- 顺序：resolveConfigPath → loadConfig（dashboard 段校验）→ `buildServer` → `listen(port ?? config.dashboard.port ?? 4317, '127.0.0.1')` → 打印 URL → `open: true`（默认）时 best-effort 打开浏览器 → 未 `--no-run` 则动态 import `runMain` 并 `await runMain({ configPath, runId: makeRunId(), cwd })`
- **run 失败保活**：runMain 抛错 → catch 打印错误摘要（错误码 + message），server 继续监听（failed run 行在页面可见）；仅 server listen 失败（EADDRINUSE 等）退出非零并提示 `--port`
- 进程存活 = server 监听中；Ctrl-C 直接退出（server.close 尽力而为）
- CLI index.ts：`start` 进 Subcommand 联合类型 + HELP + `--port`/`--no-run` 解析（现 parser 未知 flag 抛错，需补 case）

### 3.7 DDL 校对（Task 0，不改行为先对账）

- 逐字比对 `SCHEMA_SQL` 九表 vs plan §25.1-25.9 原文（docx/plan/nx-mk-plan.md 1695-1859 行），产出逐表结论（一致 / 有意偏离 + ruling 出处，如 endpoints/manifest_fields 已有的 Task 3 pre-flight ruling）
- 确认 `runs.terminated_by TEXT`、`ui_evidence.text_sample TEXT` 两处 ALTER 与 §25.1/§25.7 列序/类型补齐语义一致
- 结论落本 spec 附注；发现漂移 → 修 `SCHEMA_SQL`（IF NOT EXISTS 下仅影响新库，老库靠 ensureColumn 兜底）

---

## 4. 错误处理（只读降级 + 少量 fail-fast）

| 场景 | 处理 |
|---|---|
| `.nx-mk/` 不存在（从未 run） | `/api/runs` → `{runs:[]}`；UI 显示引导空态（"Run `nx-mk run` first"） |
| coverage.db 缺失 / readonly 打开失败（SQLITE_CANTOPEN 等） | db 句柄 = null（不抛），路由降级为目录扫描 + report 数据 |
| 查询遇 SQLITE_BUSY（写方持锁超 busy_timeout 2s） | 503 + hint `"run in progress, retrying shortly"`；UI 轮询自然重试 |
| coverage-report.json 缺失 / 解析失败 / 形状非法 | report = null；metrics/ignored → 404 + hint；requests → 回落 request_traces 投影 |
| runId 未知（目录与 db 均无） | 404 |
| requestId 未知 | 404 |
| 静态路径穿越（`..` / 绝对路径 / 越出 assets root） | 404（穿越用例测试锁定） |
| 端口被占（EADDRINUSE） | start 退出非零 + `"port <n> in use — pass --port"` |
| start 自动 run 抛错 | catch 打印错误摘要，server 保活（spec §3.5 语义） |
| config `dashboard.port` 非 int / 越界 | CONFIG_INVALID（config schema fail-fast，run 前） |
| 自动开浏览器失败（无 GUI 等） | warn 不阻断（best-effort，子进程 spawn 失败仅记） |
| run 进行中查询（WAL 并发读） | 正常返回（WAL 读写不互斥）；进行中 run 仅显示 running 状态行 |

---

## 5. 数据流

```
nx-mk start
  ├─ loadConfig（dashboard 段校验）
  ├─ buildServer({ nxMkDir, uiDistDir }) → listen 127.0.0.1:4317 → 打印 URL →（open）浏览器
  ├─ runMain(...)（--no-run 跳过；同进程）
  │    └─ …Phase 2/3 链路不变：采集 → flush → analyzer → coverage-report.json 覆盖写 + coverage_fields 落库
  └─ Dashboard 数据面（server 只读，零内核参与）：
       GET /api/* → store 三来源
         ① runs-store：.nx-mk/runs/* 目录扫描（runId 主键 + 产物存在性）
         ② db-reader：coverage.db readonly（busy_timeout 2s；WAL 与写方并发）
         ③ report-reader：coverage-report.json（形状门控；仅最新 run 有）
       UI：usePolling 每 5s 拉当前页 API + refresh 按钮
验收审计链：浏览器三指标（report）↔ runs 行（db）↔ events.jsonl 存在性 三点互证
```

进行中 run 的可见性：runs 列表即刻出现（kernel 建目录）+ status=running（db insertRun）；三指标/fields/requests 数据于 run 完成（analyzer 落盘）后由轮询带出——v0 语义即如此，不追帧。

---

## 6. 测试策略

全部 vitest，hermetic 不变（不起真浏览器、不占真端口——server 用 `inject()`，listen 只在 start 命令测试中 mock）：

| 层 | 用例要点 |
|---|---|
| runs-store | tmp 目录 fixture：多 run 目录扫描；空目录；产物存在性三布尔；非目录项忽略 |
| db-reader | 真 SQLite fixture：readonly 打开成功读 runs 行；文件缺失 → null；busy_timeout 设置生效；**打开不执行任何 DDL**（对空文件 readonly 打开失败路径） |
| report-reader | 合法 report → 对象；JSON 残缺 → null；形状非法（缺 metrics/三指标非 number）→ null；四数组缺省补 [] |
| queries | 九表行投影 camelCase；request_id 关联查询（hits/evidence 稀疏 → 空数组）；coverage_fields 十三列逐列 |
| routes | inject × 7 路由：正常 / 404（未知 id）/ 降级三态（.nx-mk 缺、db 缺、report 缺）/ 503（busy 模拟）；无 report 时 requests 回落投影 |
| static | `/` 返回 index.html；`/assets/app.js` 返回文件 + Content-Type；穿越矩阵（`../`、编码 `%2e%2e`、绝对路径）→ 404 |
| start 命令 | runMain mock seam：run 抛错 → server 仍存活且错误已打印；`--no-run` 不调 runMain；EADDRINUSE → 退出非零；--port 覆盖 config |
| config | dashboard 段 schema：合法 {port,open} / port 非 int / 越界 / 缺省通过 |
| UI 纯逻辑 | router 模式表匹配（含参数提取、未匹配）；usePolling（fake timers：首拉/间隔/refresh/unmount 清理/错误后继续）；api getJson（2xx/404 hint/网络错） |
| 集成（tests/integration） | buildServer + 真 fixture `.nx-mk`（Phase 3 同款 SQLite 生成器）→ 7 路由端到端 inject；页面级 URL→数据契约抽查 |
| demo | 手动验收 = §1.4.1 |

计数基线：330 → 预计 +50±15，全部通过；`corepack pnpm run demo:typecheck` 绿（demo config 新增 dashboard 段过 schema）。

---

## 7. 决策摘要

| # | 决策 | 理由 |
|---|---|---|
| D1 | 纯只读范围（replay/plugin settings → 4.5） | 用户已确认；两块各带跨包契约改动（§27 三分类 / §31 configSchema），拉长风险面；只读已交付 Phase 3 数据的全部可视化价值 |
| D2 | fastify + react + react-dom + vite + @vitejs/plugin-react 最小集；router/CSS/静态托管/轮询手写 | 用户已确认；plan §4.2 sanctioned 选型；供应链面锁死五项，UI 打包自含 |
| D3 | 轮询读盘（5s + refresh），SSE → 4.5 | 用户已确认；与纯只读自洽；API 路由不变，升级 SSE 不动契约 |
| D4 | 单包 `packages/dashboard` 双构建目标（**偏离 plan §8 dashboard-server/dashboard-ui 两包**） | server 与 UI 共享 API 契约类型零拷贝；避免跨包产物路径耦合；4.5 若写路径复杂化再拆 |
| D5 | start = listen 先行 + 同进程自动 run（--no-run 关）；run 失败 server 保活 | 用户已确认；贴合 plan §7「一键 Dashboard + 分析」；失败 run 可视本身就是 Dashboard 价值 |
| D6 | server 只读三来源（目录/readonly db/report json），不复用 CoverageDb | CoverageDb 构造即建表+ALTER（写语义）；readonly + WAL 天然并发安全 |
| D7 | DDL 校对作为 Task 0 | 查询层写之前必须锁定 §25 对齐；用户已确认仅带入此项，其余 12 项 parked |
| D8 | Phase 3 backlog 其余 12 项不带入 | 均为测试补强/代码卫生，与 Dashboard 无交互；继续 parked 至 4.5+ |
| D9 | 手写静态托管（不引 @fastify/static） | 仅需 `/` + `/assets/*` 两类路由；穿越面小且测试锁定；守住 D2 五项边界 |
| D10 | config 收 `dashboard: {port, open}` 两键（defaultView 不收） | plan §10 对齐；port/open 是 start 命令直接消费的最小集 |
| D11 | hash 路由（非 history 路由） | 免 SPA fallback、免服务端路由协同；本地分析台 URL 美观度次要 |
| D12 | 历史旧 run 无三指标（report 覆盖写）；fields/requests 从 db 可查 | report 是 run 级覆盖写产物（Phase 3 D7）；metrics-from-db 回算 YAGNI，4.5 评估 |

---

## 8. 风险与规避

| 风险 | 缓解 |
|---|---|
| 手写静态托管路径穿越 | 归一化 + root 前缀强制 + 穿越矩阵测试（含编码变体）；仅 127.0.0.1 绑定 |
| better-sqlite3 readonly 与写方并发异常 | WAL 为 Phase 2 既有行为（读写不互斥）；busy_timeout 2s + 503 + UI 轮询自愈 |
| start 同进程：run 崩溃带崩 server | runMain try/catch 边界（JS 层错误全覆盖）；native 崩溃概率极低，接受（server 进程独立重启成本低） |
| request detail 关联稀疏（DOM evidence 无 request_id、proxy hits 部分缺） | v0 数据现实（Phase 2 采集语义）；空关联显示 "not associated" 不臆造；endpoint 消歧本就推 Phase 4/5（Phase 3 spec §3.1 已记录） |
| react/vite 版本漂移踩坑 | 版本钉主版本（^19/^6）+ lockfile；demo:typecheck 与全量测试双门 |
| 两套构建（tsup+vite）增加包复杂度 | 构建脚本各 ~10 行；CI 顺序沿用 client→…→dashboard 追加尾部 |
| dashboard 包文件数膨胀破 400 行纪律 | 路由按资源 5 文件、页面 7 文件天然分散；review 锁 |
| UI 手测面广（7 页 × 降级态） | 页面组件薄（渲染 store 形状）；逻辑全在已测 router/polling/api；demo 手动验收覆盖主路径 |

---

## 9. 自检

- [x] 无 TBD/占位段
- [x] 与 plan §4/§5.2/§7/§10/§30/§42 对齐（D4 两包→单包、D11 history→hash、D10 defaultView 不收，三处偏离均显式记录）
- [x] Phase 3 遗留承接：DDL 校对带入（Task 0）；其余 12 项 parked 有出处（PR #9）
- [x] 范围单一可承载单实施计划；非目标明确（4.5 清单可直接作为下期范围起点）
- [x] 错误路径有归属（§4 表 12 行全覆盖，只读降级 + 少量 fail-fast 分明）

---

## 附注 A：DDL 校对结论（Phase 4 Task 0）

> 校对对象：`packages/coverage/src/db/schema.ts` 的 `SCHEMA_SQL` 九表 vs plan 原文 §25.1-25.9
> （`docx/plan/nx-mk-plan.md` 1695-1857 行；`grep -n "^### 25\."` 实测定位与预期一致）。
> 列清单记法：`PK` = PRIMARY KEY、`NN` = NOT NULL，未标注即该类型可空；列序即原文列序。

| 表 | §25 原文 | SCHEMA_SQL | 结论 |
|---|---|---|---|
| runs (§25.1) | id TEXT PK; started_at TEXT NN; ended_at TEXT; status TEXT NN; project_name TEXT; dashboard_url TEXT; manifest_hash TEXT; config_path TEXT; resolved_config_path TEXT | 一致（9 列同名同型同约束同序） | 一致（+ terminated_by 为 ensureColumn 增量） |
| endpoints (§25.2) | id TEXT PK; run_id TEXT NN; method TEXT NN; path TEXT NN; operation_id TEXT; summary TEXT | 前 5 列逐字一致；末列 `tags TEXT` 替原文 `summary TEXT` | 有意偏离：Task 3 pre-flight ruling 最小列集（ruling 列集 `endpoints(id, run_id, method, path, operation_id, tags)`，出处见注 1；schema.ts 头注释已引用） |
| manifest_fields (§25.3) | id TEXT PK; run_id TEXT NN; endpoint_id TEXT NN; direction TEXT NN; status TEXT; path TEXT NN; normalized_path TEXT NN; type TEXT; required INTEGER; schema_name TEXT; description TEXT | 8 列 ruling 集：id TEXT PK; run_id TEXT NN; endpoint_id TEXT（放宽为可空）; field_path TEXT NN; normalized_path TEXT NN; type TEXT; required INTEGER; nullable INTEGER | 有意偏离：同 ruling 最小列集——收窄掉 direction/status/schema_name/description，`path`→`field_path` 改名，`endpoint_id` 放宽可空，增 `nullable INTEGER`；逐项均落在 ruling 列集内，无 ruling 外差异 |
| request_traces (§25.4) | id TEXT PK; run_id TEXT NN; trace_id TEXT NN; scenario_id TEXT; dsl_step_id TEXT; endpoint_id TEXT; method TEXT NN; url TEXT NN; path TEXT; status INTEGER; duration_ms INTEGER; started_at TEXT; ended_at TEXT; replayable INTEGER; replay_safety TEXT; replay_reason TEXT | 一致（16 列逐列） | 一致 |
| request_fields (§25.5) | id TEXT PK; run_id TEXT NN; request_id TEXT NN; field_id TEXT; field_path TEXT NN; normalized_path TEXT NN; value_state TEXT NN; value_type TEXT; value_preview TEXT; value_hash TEXT; policy_status TEXT; matched_rule_pattern TEXT; matched_rule_reason TEXT | 一致（13 列逐列） | 一致 |
| field_hits (§25.6) | id TEXT PK; run_id TEXT NN; request_id TEXT; endpoint_id TEXT; field_id TEXT; field_path TEXT NN; normalized_path TEXT NN; count INTEGER NN; first_hit_at TEXT; last_hit_at TEXT; route TEXT; source TEXT | 一致（12 列逐列） | 一致 |
| ui_evidence (§25.7) | id TEXT PK; run_id TEXT NN; request_id TEXT; field_id TEXT; field_path TEXT NN; evidence_type TEXT; selector TEXT; visible INTEGER; in_viewport INTEGER; route TEXT; screenshot_path TEXT | 一致（11 列逐列） | 一致（+ text_sample 为 ensureColumn 增量） |
| coverage_fields (§25.8) | id TEXT PK; run_id TEXT NN; field_id TEXT NN; endpoint_id TEXT; field_path TEXT NN; policy_status TEXT NN; coverage_state TEXT NN; access_hit INTEGER; ui_hit INTEGER; assertion_hit INTEGER; suspicious INTEGER; counted_required INTEGER; counted_effective INTEGER | 一致（13 列逐列） | 一致 |
| agent_iterations (§25.9) | id TEXT PK; run_id TEXT NN; iteration INTEGER NN; status TEXT NN; summary TEXT; before_coverage REAL; after_coverage REAL; diff_path TEXT; started_at TEXT; ended_at TEXT | 一致（10 列逐列，含 2 列 REAL） | 一致 |

ALTER 一致性：runs.terminated_by TEXT / ui_evidence.text_sample TEXT 均为冻结 DDL 之外的纯增量列，
与 §25 不冲突；老库经 ALTER、新库 CREATE 后 ensureColumn 幂等跳过。
（实现位于 `client.ts` 构造器：先跑 `SCHEMA_SQL` 建表循环，再 `ensureColumn('runs','terminated_by','TEXT')`
与 `ensureColumn('ui_evidence','text_sample','TEXT')`；ensureColumn 先查 `PRAGMA table_info` 再 ALTER，
重复调用安全。§25.1 runs 九列、§25.7 ui_evidence 十一列均不含 terminated_by / text_sample，
两列系 Phase 3 按 spec §3.1 schema 演进规则（DDL 冻结、新列 ALTER 落地）新增，纯增量。）

注 1（ruling 出处）：Task 3 pre-flight ruling 见 Phase 2 计划
`docs/superpowers/plans/2026-09-16-phase2-collection.md` Task 3 Step 3a——
「endpoints / manifest_fields 补充列（plan 未定义，按 runtime 需要最小化）：
endpoints(id, run_id, method, path, operation_id, tags)、
manifest_fields(id, run_id, endpoint_id, field_path, normalized_path, type, required, nullable)」。
schema.ts 头注释（「plan 原文与 ruling 冲突时，ruling 优先」）及两表上方行内注释均已引用该裁定，
SCHEMA_SQL 两表列集与 ruling 逐字一致。校对注记：ruling 原文称「plan 未定义」，
与现行 plan §25.2/§25.3 已载 DDL 的表述有出入，但不影响裁定效力——ruling 列集即两表的实施权威定义；
另 manifest_fields 的偏离严格说并非纯「列集收窄」（含改名/放宽可空/增列），
但每一项均由上述 ruling 列集显式覆盖。

结论：除两处已裁定偏离外，九表无任何漂移（列名/类型/约束/列序全部一致），SCHEMA_SQL 未改动，本次仅落档。
验证：`npx vitest run packages/coverage` 全绿（输出见任务报告）。
