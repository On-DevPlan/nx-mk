# nx-mk Spec: Phase 2 — 采集 (Runtime Proxy / Collector / Playwright / SQLite / UI Evidence v0)

> 日期：2026-09-16
> 范围：Phase 2 — 让 coverage 数据真正流动（request trace + field-hit + UI evidence 落库）
> 不在范围：Phase 3 分析（policy-engine 全量 / anti-cheat）、Phase 4 Dashboard、Phase 5 Agent、scenario DSL/Replay、Evidence Quality 评分、隐私脱敏
> 关联文档：
> - `docx/plan/nx-mk-plan.md`（Plan §18 Runtime Instrumentation、§19 字段级 Proxy、§20 UI Evidence、§25 SQLite、§41 MVP、§42 Phase 2 roadmap）
> - `docs/superpowers/specs/2026-09-16-nx-mk-phase15-close-loop-sdk-cg3-design.md`（Phase 1.5 闭环 — runtime seams 的来源）
> - 参考分层：`github.com/On-DevPlan/nx-ce`（纯函数核心 + 薄适配）

---

## 1. 目标与非目标

### 1.1 现状与缺口

Phase 1.5 交付了采集的全部接入缝，但数据流未流动：

1. runtime `createFetchClient` 声明了 `mode: 'analysis'` 与 `onRequest/onResponse`（client.ts:21-25），analysis 分支是**空占位**——无字段代理、无采集
2. Field 组件已渲染 `data-mk-field` 属性，但**无 DOM 扫描**消费
3. Goal Loop 有 `field-hit` report 分支（kernel types.ts:174-176），但**无人产生** field-hit
4. 计划 §25 的 9 张表**全部未建**；`.nx-mk/runs/` 只有 events.jsonl
5. 无 Playwright 接入；UI evidence 无来源

### 1.2 目标

本 spec 交付后：

1. **字段级 Proxy**（Plan §19 逐字）：analysis 模式下 `api.users.getUser()` 返回的响应对象被 tracked proxy 包裹——字段读取（含嵌套 `data[].user.id`）触发 `collector.hit()`，数组元素路径按 §17 归一化（下标→`[]`）；WeakMap 缓存 + §19.3 不代理名单锁死
2. **Collector**：内存缓冲 request trace / field-hit，run 结束统一 flush
3. **SQLite trace store**（Plan §25）：better-sqlite3 + WAL，9 张表 DDL 逐字（`agent_iterations` 建表但 Phase 2 只写入 admin 空表；`coverage_fields` 在 afterRun 由 coverage analyzer 填充）
4. **plugin-playwright**：kernel Plugin 协议接入（用户已确认插件化）；Goal Loop turn 驱动下打开页面、DOM 扫描 `[data-mk-field]` 采 UI evidence（v0 仅 `text` 类型）、emitReport 对接 Goal Loop
5. **Production 零开销回归锁死**：production 路径零字节分析逻辑（测试断言 noop collector + 无 proxy wrapper）
6. `nx-mk run` 能驱动 demo app 采到 field_hits + ui_evidence（§42.5 验收延伸）

### 1.3 非目标

- Dashboard（Phase 4）、Agent（Phase 5）
- policy-engine 全量 / anti-cheat / Evidence Quality（Phase 3）—— coverage analyzer 只做 required-未访问=missing 的极简版
- scenario DSL / Replay（§26/§27）
- Playwright 多浏览器、并发 3（MVP 单 chromium）
- POST 自动复现、ODE 自动提交
- HTTP collector server（window.__MK_COLLECTOR__ 单通道，Phase 4 再考虑上报协议）
- evidence_type 其余 6 种（attribute/image-src 等——v0 只做 text）

### 1.4 成功标准

1. `nx-mk run`（analysis session）在 demo 上：SQLite `field_hits` 非空、`ui_evidence` 非空、`request_traces` 非空
2. Goal Loop 因 field-hit 上报提前 goal-met（而非跑满 max-turns）
3. production 模式回归：`createFetchClient` 默认 mode 下无 proxy、无 collector（零开销测试）
4. 全部测试通过（当前 198 → 预计 +50±20）；`demo:typecheck` 通过
5. §19.3 不代理名单行为有逐条单测

---

## 2. 仓库架构

### 2.1 目录变化

```
packages/client/src/
├── proxy/
│   ├── index.ts                      # 公共导出
│   ├── create-tracked-proxy.ts       # §19 tracked proxy（WeakMap 缓存 + 不代理名单）
│   └── path-normalizer.ts            # §17 数组下标 → []（复用/对齐 manifest-schema normalize）
├── collector/
│   ├── index.ts
│   ├── collector.ts                  # 内存缓冲聚合（纯数据结构，无 IO）
│   └── noop-collector.ts             # production 占位（零开销）
├── mode/
│   └── analysis.ts                   # analysis 增强组装（bindManifest + fieldProxy + collector）
└── runtime/
    └── client.ts                     # ← 修改：fetch 后对响应 JSON 挂 proxy（analysis 时）
packages/coverage/                    # ← 新包 @nx-mk/coverage
├── package.json                      # +better-sqlite3
├── src/
│   ├── index.ts
│   ├── db/
│   │   ├── schema.ts                 # §25 DDL（9 张表逐字）
│   │   └── client.ts                 # better-sqlite3 wrapper（WAL + 事务批量 flush）
│   ├── request-trace/
│   │   └── trace-store.ts            # request_traces / request_fields 写入
│   ├── evidence/
│   │   ├── dom-scanner.ts            # DOM 扫描逻辑（可独立单测的纯描述）
│   │   └── ui-evidence.ts            # ui_evidence 表写入
│   └── analyzer/
│       └── coverage-analyzer.ts      # coverage_fields 表填充（极简 policy v0）
│   └── __tests__/
└── vitest.config.ts                  # 沿用 client 布局（__tests__/ 在 src 外层）
packages/plugin-playwright/           # ← 新包（kernel Plugin）
├── package.json
├── tsup.config.ts
└── src/
    ├── index.ts                      # createPlaywrightPlugin(): Plugin
    ├── scanner.ts                    # 页面扫描 + evidence 提取（page.evaluate 注入脚本）
    ├── __tests__/
packages/cli/src/
├── commands/run.ts                   # +analysis session 装配（collect config 段）
examples/react-vite-demo/
├── nx-mk.config.yml                  # +collect 段（port: 5173）
├── app/vite.config.ts                # +define __MK_ANALYSIS__（env 开关）
tests/
└── integration/phase2-collect.test.ts  # hermetic 集成（不真跑浏览器——见 §6）
```

### 2.2 依赖变化

- `@nx-mk/coverage`（新）：`better-sqlite3`（SQLite）、`@nx-mk/manifest-schema`（类型）
- `@nx-mk/plugin-playwright`（新）：`@nx-mk/kernel`（Plugin 协议）、`playwright-core`（chromium 驱动）
- root devDependencies：`@nx-mk/coverage`、`@nx-mk/plugin-playwright`（集成测试需要）
- `@nx-mk/client`：无新依赖（proxy/collector 纯 TS）
- 引入新第三方仅 `better-sqlite3`（既有决策）与 `playwright-core`（bindings 已在环境；若 unavailable 用 `playwright` 完整包，实施时定）

---

## 3. 组件职责

### 3.1 tracked proxy（`packages/client/src/proxy/`，Plan §19 逐字）

```ts
interface TrackedProxyOptions {
  requestId: string
  endpointId: string
  basePath: string              // 'data' 起始
  collector: Collector          // hit(record: FieldHit): void
}
function createTrackedProxy<T extends object>(target: T, options: TrackedProxyOptions): T
```

- **§19.2 行为**：get 拦截 → `fieldPath = normalizePath(basePath.prop)` → `collector.hit()` → 值若可代理则递归包裹
- **§19.3 不代理名单**：Date/File/Blob/Map/Set/WeakMap/WeakSet/Promise/Error/RegExp/URL/FormData/ArrayBuffer/class instance（`Object.prototype.toString` 判 native class）；只代理 plain object 与 array
- **§19.4 缓存**：模块级 `WeakMap<object, object>`，避免 React 无限触发与引用比较失效
- **数组归一化**：`data[0].id` 路径中下标 → `data[].id`（§17）
- symbol prop、getter 异常 → 透传，不抛错

### 3.2 collector（`packages/client/src/collector/`）

```ts
interface Collector {
  hit(hit: FieldHitCore): void        // 字段读取（proxy 调用）
  trace(trace: RequestTrace): void    // 请求级 trace
  evidence(ev: UiEvidence): void      // UI evidence（plugin-playwright 注入）
  snapshot(): CollectSnapshot         // Goal Loop turn 结束取增量
  flush(db: CoverageDb): void         // 落 SQLite
}
function createCollector(): Collector          // 内存缓冲
function createNoopCollector(): Collector      // production（零开销：全部 no-op）
```

- 纯内存数据结构（Map by fieldPath 聚合 count）—— IO 完全在 `flush()`（纯函数核心 + IO 剥离，nx-ce 分层）
- `snapshot()` 输出 `PluginReport[]`（对齐 kernel types `field-hit` / `endpoint-called`），由 plugin-playwright（或 run 装配层）喂给 `ctx.emitReport`

### 3.3 SQLite（`packages/coverage/src/db/`）

- `schema.ts`：§25 的 9 张表 DDL **逐字**（runs/endpoints/manifest_fields/request_traces/request_fields/field_hits/ui_evidence/coverage_fields/agent_iterations）
- `client.ts`：better-sqlite3 wrapper —— 打开 db（`.nx-mk/coverage.db`）、`PRAGMA journal_mode=WAL`、提供 `flush(snapshot)` 事务批量写
- 无 migrations 框架（YAGNI）：`CREATE TABLE IF NOT EXISTS`，schema 漂移留给 Phase 4

### 3.4 plugin-playwright（kernel Plugin 协议）

```ts
interface CollectConfig {
  url: string                    // vite dev server URL
  waitForSelector?: string       // 默认 '[data-mk-field]'
  maxTurns?: number              // 默认 3
}
hooks: {
  beforeRun(ctx)   // doctor 语义：chromium 可执行性检查（不可用时 KernelError PLUGIN_HOOK_FAILED）
  run(ctx)         // 每 turn：page.goto → 等 selector → page.evaluate(DOM 扫描) → evidence 进 collector → snapshot emitReport
}
```

- DOM 扫描（`page.evaluate` 注入脚本）：读 `[data-mk-field]` → `{field, visible: isVisible(), inViewport: 与 boundingBox+viewport 相交, evidenceType: 'text'}` 数组
- 每个 turn 后 emitReport 聚合（field-hit 来自 window/__MK_COLLECTOR__ 缓冲 + DOM 扫描 evidence 匹配 fieldId）
- 页面关闭与 browser 生命周期在本插件内管理（beforeRun 启动、shutdown 关闭）

### 3.5 runtime analysis 分支（`packages/client/src/mode/analysis.ts` + client.ts 修改）

`createFetchClient` fetch 后：

```ts
if (isAnalysis) {
  const requestId = genId()
  collector.trace({ requestId, method, url, status, durationMs })
  // JSON 响应 → tracked proxy 包裹后再返回
  const data = await res.json().catch(() => undefined)
  return (data !== undefined ? createTrackedProxy(data, { requestId, endpointId, basePath: 'data', collector }) : data) as T
}
// production 分支维持现状（零改动零开销）
```

- `detect()` 已有 `__MK_ANALYSIS__` 编译期注入 + process.env 运行期 fallback，维持
- endpointId 绑定：URL → manifest endpoint 匹配（Phase 1.5 同源段匹配逻辑复用）

### 3.6 CLI `nx-mk run` 装配

- config 新增 `collect?: { url: string; maxTurns?: number }` 段（config schema 扩展，M2 validator 同步）
- `run` 命令检测到 `collect` 配置时：装配 plugin-playwright 到 kernel（插件自动加载已在 plugins 数组声明）、传递 ws collector 路径

---

## 4. 错误处理（fail-fast）

| 场景 | 处理 |
|---|---|
| plugin-playwright：chromium 不可用 | beforeRun 抛 `KernelError('PLUGIN_HOOK_FAILED')`，消息提示 `npx playwright install chromium` |
| collect 配置 URL 不可达（turn 1 goto 失败） | 抛 `PLUGIN_HOOK_FAILED`，fail-fast（用户需先起 vite） |
| DOM 扫描异常（页面 JS 错误等） | 该 turn evidence 结果为空数组 + logger.warn，不阻断 Goal Loop |
| collector.flush SQLite 写入失败 | 抛出（数据完整性优先于静默失败） |
| proxy 拦截内部异常 | try/catch 吞掉并返回原始值——**探针永不破坏业务请求**（与 Phase 1.5 patch 同语义） |
| 无 write 权限的 `.nx-mk/coverage.db` | db open 抛错，CLI 顶层映射退出码 |

---

## 5. 数据流（运行时序全景）

```
nx-mk run（config 含 collect 段）
  ├─ loadConfig → resolvePlugins（plugins 数组 + plugin-playwright 装配）
  ├─ beforeRun：plugin-playwright 检查 chromium；初始化 coverage.db schema
  ├─ Goal Loop turn 1..N：
  │    plugin-playwright.run：
  │      page.goto(collect.url) → waitForSelector('[data-mk-field]')
  │      page.evaluate(DOM 扫描) → evidence[] → collector.evidence(ev)
  │      window.__MK_COLLECTOR__.snapshot() → 请求 trace + proxy field-hit 增量
  │      → ctx.emitReport({kind:'field-hit', fieldId, count, turn})    （Goal Loop 消费）
  │           + ctx.emitReport({kind:'endpoint-called', method, path, turn})
  │    computeCoverage → coverage[N] → termination 检查（goal-met / idle / max-turns）
  ├─ run 阶段结束：
  │    collector.flush(coverage.db)  ← 一次事务批量写 9 表
  └─ afterRun / shutdown：browser 关闭、db close
```

窗口内既有体系分工不变：plugin-swagger 在 beforeRun 产 manifest（Goal Loop initial coverage 已接）；plugin-playwright 是新的多生产者之一。

---

## 6. 测试策略

全部 vitest 单测 + 2 类集成测试。**hermetic 约束**（不真跑 chromium/SQLite 大场景）：

| 层 | 用例要点 |
|---|---|
| tracked proxy（client） | 嵌套字段路径、数组 `data[0].id → data[].id` 归一化、§19.3 不代理名单逐条、WeakMap 缓存引用稳定、React 风格重复读、探针异常不抛 |
| collector（client） | hit 聚合（同 fieldPath count 合并）、snapshot 增量、noop 零开销（调用不进缓冲）、trace/evidence 缓冲、flush 到 fake db |
| SQLite schema/store（coverage） | 9 张表 DDL 逐字建表断言（`PRAGMA table_info` 对照）、WAL 模式开启、事务 flush 批量写 + 读回验证 |
| dom-scanner（coverage） | 注入 HTML fixture（jsdom 可选；若引入则 del playwright 依赖）→ 扫描 [data-mk-field] → 数组结构正确 |
| coverage-analyzer（coverage） | required 未访问 = missing、field-hit 覆盖 → counted |
| plugin-playwright（插件） | mock page.goto/evaluate：evidence 数组映射、emitReport 调用序、beforeRun doctor 语义、turn 终止 |
| 集成 hermetic（tests/） | 内存版 collector → 临时 SQLite 文件 → flush → 查询断言 9 表有数据（**不跑真浏览器**；真浏览器链路由 demo 手动验收或 Phase 2.5 CI 补） |
| production 零开销（client） | mode 缺省时 winner：无 proxy wrap、collector noop、请求路径无额外分配 |

计数基线：198 → 预计 +40±15，全部通过。

---

## 7. 决策摘要

| # | 决策 | 理由 |
|---|---|---|
| D1 | 字段级 Proxy 全量实现（§19 逐字） | 用户已确认；coverage 粒度的根基；fleet verify |
| D2 | SQLite 用 better-sqlite3 | 用户已确认；同步 API + Windows 预编译产物；Node 22 兼容 |
| D3 | Playwright 以 kernel Plugin 接入 | 用户已确认；复用 Goal Loop 多生产者机制，验收形态闭环 |
| D4 | proxy/collector 放 client 内部子模块（不拆新包） | plan §8 client/ 布局如此；避免 client 被业务依赖拉进 collector 依赖（analysis 代码路径独立于 production） |
| D5 | collector→SQLite 单通道（window.__MK_COLLECTOR__ + page.evaluate flush） | YAGNI；无 HTTP 上报 server；Phase 4 dashboard 时再评估 |
| D6 | UI evidence_type v0 只做 text | §20.2 其余 6 类后置；demo 已渲染 data-mk-field，text 已够验收 |
| D7 | 极简 policy v0（required 未访问=missing） | Phase 3 前 beacon；Goal Loop 已有 field-hit 消费，不重复实现 |
| D8 | 集成测试 hermetic（不跑真浏览器） | CI 稳定性；真实浏览器链路 Phase 2.5 CI 补 |
| D9 | plugin-playwright 用 playwright-core/playwright bindings | 环境已用 Playwright；实施时按可用性选 playwright 或 playwright-core |

---

## 8. 风险与规避

| 风险 | 缓解 |
|---|---|
| Proxy + React 产生无限 render | §19.4 WeakMap 缓存（引用稳定）+ 探针 try/catch；demo:typecheck + 手工验证 |
| better-sqlite3 Windows 预编译失败 | pnpm 有 prebuilt 产物；失败时 fallback node:sqlite（Node 22 内置，已验证 22.23） |
| Playwright 页面时序（vite dev 冷启动） | waitForSelector + 超时 fail-fast；collect.url 由用户保证可达（与 demo 后端同语义） |
| fieldProxy 与 Goal Loop turn 集成复杂 | collector.snapshot 纯增量；plugin-playwright 只在 turn run 时读快照，不阻塞 |
| SQLite flush 数据大时阻塞 | WAL + 事务批量写；v0 数据量小（demo 3 endpoints） |

---

## 9. 自检

- [x] 无 TBD/占位段（D9 留 playwright vs playwright-core 为实施期选择项，非设计缺陷）
- [x] 与 Plan §18/19/20/25/41 逐字对齐（D1/D3/D6 均引用对应节）
- [x] 与 Phase 1.5 交付兼容（detectMode/onRequest 缨/data-mk-field 全部复用）
- [x] 范围单一可承载单实施计划；非目标明确（dashboard/agent/DSL/replay 全后置）
- [x] 错误路径有归属（fail-fast 表 + proxy 探针永不抛）
