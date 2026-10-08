# devops-incidents（验证项目三）

形状族：**同 path 多状态码（200 / 503 双响应 schema）/ 非 2xx 响应体字段 / 数组 + 双对象嵌套 / nullable**

四个 endpoint（其中 `getServiceHealth` 同 path 双状态码），全部由单页自驱动渲染：

| endpoint | 方法 | 路径 | 状态码 | manifest 路径数 |
|---|---|---|---|---|
| `listServices` | GET | `/services` | 200 | 7（6 叶子 + `dependencies[]` 数组叶） |
| `listServiceIncidents` | GET | `/services/{serviceId}/incidents` | 200 | 13（6 标量 + `assignee` 父 + 3 assignee 叶 + `impact` 父 + `usersAffected` + `regions[]`） |
| `getServiceHealth` | GET | `/services/{name}/health` | **200** | 5（`data.status` + `data.checks[].{name,passed,latencyMs,message}`） |
| `getServiceHealth` | GET | `/services/{name}/health` | **503** | 4（`data.code` / `data.message` / `data.retryAfterSeconds` / `data.contact`） |
| `createIncidentNote` | POST | `/incidents/{incidentId}/notes` | 201 | 2（**201 回显** `data.body` / `data.createdAt`） |

35 条 manifest 字段里 `data[].id` 同时是 `listServices` 与 `listServiceIncidents` 的
manifest 字段（同 normalizedPath、不同 fieldId）；按 A4 跨 endpoint 取最差质量。
**`data.status`（200 分支）与 `data.code`（503 分支）是不同的 normalizedPath**
（field-id 派生键含 status 段，`packages/manifest-schema/src/field-id.ts:20`），两组互不相干。

## 核心验证点：同 path 多状态码 + 非 2xx 响应字段覆盖

spec §3.3 / §9 的头号风险点：

- **同 path 双状态码**：`/services/{name}/health` 同时声明 200 与 503 两组响应 schema。
  manifest 为每组各自派生 fieldId（派生键含 status 段），两组在分母里互不相干。
- **非 2xx 响应字段**：SDK 的 `client.ts:177` 对 `!res.ok` 直接 throw，**不解析响应体**——
  503 的 4 个字段通过 SDK 走不通。`HealthChecker` 用**原生 fetch** 绕开 SDK
  （`fetch('/api/services/down-api/health')`），拿到响应体后**渲染成带 `data-mk-field`
  的可见元素**，DOM 扫描产出 `ui_evidence` → analyzer 的 `accessHit || uiHit`
  （`coverage-analyzer.ts:102`）判 covered。
- **shim 前缀要求**：原生 fetch 必须打 `/api` 前缀路径 —— `scanner.ts:132` 的 shim
  只观测 `/api` 前缀（不影响 evidence，但保证 `request_traces` 非空）。

## 启动与验收

```bash
# 0. 依赖 + 浏览器
pnpm install && npx playwright install chromium

# 1. 构建工作区包 —— 必须先跑，且顺序有讲究！
#    nx-mk CLI 走 packages/cli/dist/index.js、各包 main 都指 dist/，
#    而 dist/ 被根 .gitignore 忽略（.gitignore:6）、仓库无 postinstall/prepare 钩子，
#    故全新 clone 后不构建就没有 CLI 可执行 —— 下面第 5 步会 ENOENT。
#    kernel 要先单独构建（config 与 kernel 互为 workspace 依赖，
#    pnpm 拓扑排序会把 config 排在 kernel 之前，导致 config 的 dts 读不到 kernel 类型）。
#    照根 README「开发」节的写法：
cd packages/kernel && node ../../node_modules/tsup/dist/cli-default.js && cd ../..
pnpm -r --workspace-concurrency=1 build

# 2. 生成 OpenAPI spec —— 也必须先跑！
#    swagger/openapi.json 是派生产物（项目 .gitignore 忽略了它），不入库。
#    少了这一步，第 5 步会以 PLUGIN_HOOK_FAILED 退出（ENOENT）。
pnpm incidents:openapi

# 3. 后端（8803）
pnpm --filter @nx-mk-example/incidents-server dev

# 4. 前端（5203）—— MK_ANALYSIS 必须给 vite 进程，不是给 CLI。
#    ⚠️ 启动后核对 banner 的 Local 端口确为 5203：若打出行
#    "Port 5203 is in use, trying another one"，说明有孤儿 vite 占着端口、
#    本进程已换端口 —— 此时 run 扫到的是孤儿（没有 analysis 模式），
#    断言 H 必红。见「已知限制」第 6 条。
MK_ANALYSIS=true pnpm --filter @nx-mk-example/incidents-app dev

# 5. 采集 + 验收（项目目录内）
cd examples/devops-incidents
node ../../packages/cli/dist/index.js run
node verify-coverage.mjs
```

`verify-coverage.mjs` 不依赖构建产物：它经 `createRequire` 从 `packages/<pkg>` 的路径
解析 `yaml` 与 `better-sqlite3`，Node 按路径逐级上溯，**不 stat 那个基准文件**，
所以即使 `packages/*/dist/` 不存在也能解析（两包各自声明了这两个依赖）。
真正需要构建的只有步骤 5 里的 CLI（`packages/cli/dist/index.js`）。

`verify-coverage.mjs` 只读 `nx-mk run` 的产物做断言，**不自己重算覆盖率** ——
100% 的账本只有 `coverage-report.json` 与 `coverage.db` 一处。

## 503 错误分支专项诊断

本项目最可能卡住的地方 —— 4 条非 2xx 响应字段的覆盖路径与以往项目不同：

| 症状 | 根因 | 修法 |
|---|---|---|
| `data.code` 等 4 个字段 missing | 503 错误卡未渲染出 `data-mk-field` | 打开 app 页面确认 `[data-testid='health-error'] dl` 存在；若只有「正在探测…」说明 fetch 未拿到 503 —— 用浏览器 DevTools 看 `/api/services/down-api/health` 实际状态码 |
| fetch 拿不到 503 | server 侧 `name.includes('down')` 未命中 | 确认请求路径为 `/api/services/down-api/health`（vite proxy 剥 `/api` 后 server 收到 `/services/down-api/health`） |
| 错误卡渲染了但仍 missing | manifest 里 503 字段的 `normalizedPath` 不是 `data.code` 等 | 跑 `node -e "console.log(require('./.nx-mk/manifest.json').fields.map(f=>f.status+':'+f.normalizedPath).join('\n'))"` 核对实际路径，按实际值改页面字面量 |
| `data.status` missing | 200 分支未渲染 | 检查 `api.health.getServiceHealth` 是否成功（catch 里吞了错误 → 静默失败）；临时去掉 `.catch` 看真实错误 |

## 口径说明

- **同 path 多状态码（spec §3.3）**：`getServiceHealth` 同 path 声明 200 与 503 两组
  schema。`field-id.ts:20` 的 rawKey 含 status 段（`status:${status}`），故两组各自派生
  独立 fieldId —— 200 的 `data.status` 与 503 的 `data.code` 是**不同** normalizedPath。
  两组互不拖累（A4 取最差质量按 normalizedPath 索引）。
- **C2 绕行（spec §2）**：SDK 对 `!res.ok` 直接 throw（`client.ts:177`），错误响应体
  拿不到。`HealthChecker` 用**原生 fetch**（`fetch('/api/services/{name}/health')`）
  绕开 SDK，拿到响应体后渲染成带 `data-mk-field` 的元素。DOM 扫描产出 `ui_evidence`
  （与 HTTP 通道无关），analyzer 的 `accessHit || uiHit` 判 covered
  （`coverage-analyzer.ts:102`）。故**非 2xx 响应字段在真 100% 口径下可达**。
- **shim 前缀要求（spec §5）**：`scanner.ts:132` 的 shim 只观测 `/api` 前缀请求
  （`pathname === '/api' || pathname.indexOf('/api/') === 0`），故原生 fetch 必须打
  `/api` 前缀路径 —— 否则该请求不进 `request_traces` 表，断言 H 必红。
- **P1**：coverage 分母只含响应字段。`listServiceIncidents` 的路径参数 `serviceId`、
  `getServiceHealth` 的路径参数 `name` 不进分母。
- **对象级父描述符**：`schema-walker` 对 plain object 属性产父描述符（`data[].assignee`、
  `data[].impact` 各占分母一条），对 array-of-object **不**产。故两条父路径各渲染一个
  **叶子摘要** Field（如 `（u_07 · 陈工 · chen@example.com）`），不能是空 span 或裸 JSON。
- **nullable**：`inc_001.resolvedAt` 为 null → 页面渲染 `'—'` 占位（A1/A2；
  `generateSdk` 丢可空性，TS 不会提醒）。
- **A1/A2**：所有 Field 的 children 都过占位符兜底（`'—'`），保证 span 内恒有非零可见
  文本。字符串用 `||`、数值用 `??`（`usersAffected=0` 是合法测量值，`||` 会吞成 `'—'` 失真）。
- **A3**：enum 映射中文标签（`status → 健康/降级/宕机`、`severity → 严重1级/严重2级/严重3级`、
  `code → 服务不可用/上游超时/触发限流`），局部变量带 `Text` 后缀。
- **A4**：`data[].id` 同时是 `listServices` 与 `listServiceIncidents` 的 manifest 字段，
  analyzer 按 `normalizedPath` 单独索引并取最差质量。两处 children 均为 valid，无相互拖累。
- **S2/S4/S5**：场景 DSL 只有 `goto`/`waitFor`/`waitForRequest`/`assertFieldVisible`/`screenshot`
  五种 step，无 `click`/`fill`；整页导航会重置 collector 缓冲，故场景只含**一个** `goto`
  （`verify-coverage.mjs` 静态断言）；步数上限 50，本套件 38 步。
- **S3（套件是子集）**：`assertFieldVisible` 只要有**一个** `[data-mk-field="X"]` 可见即过。
  真正的门是 `verify-coverage.mjs` 的断言 B/C/D/E —— 以 `coverage-report.json` 为准。

## 已知限制

本次验证未发现 nx-mk 核心能力缺口。以下是**设计取舍与复现前置条件**，记录以免后人误判：

0. **`swagger/openapi.json` 不入库**（项目 `.gitignore` 忽略派生 spec）。
   全新 clone 必须先跑 `pnpm incidents:openapi`，否则 `nx-mk run` 以
   `PLUGIN_HOOK_FAILED`（ENOENT）退出。本 README 的步骤 2 就是它 ——
   实测：删掉 spec 与 `.nx-mk/` 后按本文步骤重跑，可复现上述全部数字。
1. **`generateSdk` 丢弃可空性** —— spec 声明 `resolvedAt: string | null`，生成类型却是
   `resolvedAt: string`（`notes` / `paidAt` 等同）。TS 不会提醒 null 防护，故组件里的
   `|| DASH` 兜底是刻意写的，不依赖类型系统。
2. **对象级 required 字段** —— 同「口径说明」第 4 条：两条父路径（`assignee` / `impact`）
   不渲染自身路径的 Field，requiredCoverage 到不了 1。
3. **场景结果不落 `scenarios.json`** —— `plugin-playwright` 只把 `scenario:done` 事件
   emit 进 `.nx-mk/runs/<runId>/events.jsonl`，且**场景失败不影响进程退出码**（只 warn）。
   故断言 G 必须解析事件流；「run 退出码 0」不能代表场景全过。
4. **`swagger/openapi.json` 与全部 `dist/` 都不入库**（派生产物）——
   全新 clone 必须先跑上面步骤 1 的构建与步骤 2 的 spec 生成。缺任一步，
   `nx-mk run` 会以 ENOENT / `PLUGIN_HOOK_FAILED` 退出。
5. **⚠️ 已知的活口：验收靠人记得重跑。** `pnpm incidents:verify-full`
   （= `verify-pages` + `verify-scan` + 本门）**没有任何东西会自动调用它** ——
   第一个（`verify-pages`）是纯静态、只需要 `.nx-mk/manifest.json`，不需要服务；
   第二个（`verify-scan`）会起 chromium 打 5203，同样需要两个服务。
   也就是说三个都不需要采集、但后两个需要服务 —— 真正能发现「采集其实已经失败」的
   只有本门（断言 A-0 比对报告与 runs 最新行）。
   断言 A-0 能拦住「陈旧报告冒充最新一次 run」，但前提是**有人跑了它**。
   在 Task 7 定下 CI 形态之前，重跑验收请显式执行：

   ```bash
   pnpm incidents:verify-full
   ```

   陈旧性为什么危险：一次失败的采集**不会删除**上一次成功的报告
   （`coverage-report.json` 只在成功路径写），只看磁盘上「有报告、指标是 100%」
   会得到一个已被推翻的结论。
6. **⚠️ 孤儿 vite 端口劫持 → 采集通道静默双黑洞（commerce-orders 实测踩中，2026-10-08）。**
   vite 的 `define` 机制（`__MK_ANALYSIS__` 经页面全局注入）本身可靠；踩坑的形状是：
   一个**没带 `MK_ANALYSIS=true`** 的旧 vite 进程占着 5203（pnpm 停后台任务后 node
   子进程常存活），新起的 vite 静默换端口（banner 打 5204），`nx-mk run` 扫到的是孤儿。
   此时**三指标照样全绿、场景照样 pass**（DOM 扫描通道不依赖 analysis 模式），只有断言 H
   （`field_hits` / `request_traces` 为空）能拦住 —— 而它的报错只有「采集没落数据」六个字。
   双黑洞的机理：SDK 的 fetch 包装发请求前置 `__MK_SDK_INFLIGHT__` 标记**不分模式**，
   shim 的 fetch 兜底补丁见标记就跳过（以为 SDK 会上报），而 production 分支根本不上报
   —— 两条通道同时哑掉。排查手段已内置进 `verify-scan.mjs`：页面全局
   `__MK_ANALYSIS__` 不为 `true` 时直接抛出含 端口核对与 netstat 定位步骤的报错，
   不必从断言 H 从零猜起。预防动作就一条：**每次起 vite 后核对 banner 端口**。
7. **503 错误分支的原生 fetch 必须真拿到 503** —— `HealthChecker` 调 `fetch('/api/services/down-api/health')`，
   server 侧 `name.includes('down')` 命中 → 返回 503。如果 server 端条件被人误改成
   `name.includes('always')`（mutate 试验时常见），fetch 会拿到 200 但 body 是 HealthOk，
   `if (res.status !== 503) return` 短路 → `errBody` 仍是 null → 503 那 4 个字段在 DOM 里
   没渲染 → scan 报 4 个 missing。**这是 C2 绕行的关键不变量**：server 的触发条件必须真
   触发，页面与 server 任一端偷改会让 503 路径静默失效。**mutation-test 必跑**（见
   `nx-mk run` 前的「自检」流程，Task 4 纪律）。

## 配套校验脚本

| 脚本 | 层 | 作用 |
|---|---|---|
| `verify-pages.mjs` | 静态 | 页面 `field` 字面量是否都在 manifest 的 `normalizedPath` 集合内；DASH 兜底是否存在；fixture 事件 / 服务的挂载断言 |
| `verify-manifest.mjs` | 静态 | manifest 双向等值（页面渲染的路径 ↔ manifest 路径，35 条） |
| `verify-scan.mjs` | 旁路 | 真浏览器 + 生产 `classifyEvidence` 复算一遍比值（**不落产物**，故不能替代验收门）；含 `__MK_ANALYSIS__` 模式前置自检；503 错误卡 dl 就绪等待 |
| `verify-coverage.mjs` | **门** | 只读 `nx-mk run` 产物，断言 A–H（含 A-0 陈旧报告防护） |

前三者都不读 `coverage-report.json`，因此都不能证明 100% —— 只有第四个能。