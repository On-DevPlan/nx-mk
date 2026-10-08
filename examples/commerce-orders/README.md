# commerce-orders（验证项目二）

形状族：**分页 envelope / 深层数组（envelope→元素→标签数组、订单→行项数组）/ 数组→对象→对象 / 双 nullable**

四个 endpoint，全部由单页自驱动渲染：

| endpoint | 方法 | 路径 | manifest 路径数 |
|---|---|---|---|
| `listProducts` | GET | `/products` | 15（envelope 标量 4 + 元素 11，含 `supplier` 父） |
| `listOrders` | GET | `/orders` | 21（含 `shipping` / `shipping.address` / `payment` 三个对象级父） |
| `getOrder` | GET | `/orders/{orderId}` | 4 |
| `createOrder` | POST | `/orders` | 4（**201 回显**，非请求体） |

44 条 manifest 字段里 `data.id` / `data.status` 被 `getOrder` 与 `createOrder`（201 回显）共用，
故**唯一路径 42 条**（A4 跨 endpoint 取最差质量，见下文「口径说明」）。
**没有 `data.createdAt`** —— `CreatedOrderSchema` 是 `{ id, status, totalAmount, placedAt }`
（brief 所列的 `data.createdAt` 为笔误，manifest 是分母的唯一事实源）。

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
pnpm orders:openapi

# 3. 后端（8802）
pnpm --filter @nx-mk-example/orders-server dev

# 4. 前端（5202）—— MK_ANALYSIS 必须给 vite 进程，不是给 CLI。
#    ⚠️ 启动后核对 banner 的 Local 端口确为 5202：若打出行
#    "Port 5202 is in use, trying another one"，说明有孤儿 vite 占着端口、
#    本进程已换端口 —— 此时 run 扫到的是孤儿（没有 analysis 模式），
#    断言 H 必红。见「已知限制」第 6 条。
MK_ANALYSIS=true pnpm --filter @nx-mk-example/orders-app dev

# 5. 采集 + 验收（项目目录内）
cd examples/commerce-orders
node ../../packages/cli/dist/index.js run
node verify-coverage.mjs
```

`verify-coverage.mjs` 不依赖构建产物：它经 `createRequire` 从 `packages/<pkg>` 的路径
解析 `yaml` 与 `better-sqlite3`，Node 按路径逐级上溯，**不 stat 那个基准文件**，
所以即使 `packages/*/dist/` 不存在也能解析（两包各自声明了这两个依赖）。
真正需要构建的只有步骤 5 里的 CLI（`packages/cli/dist/index.js`）。

`verify-coverage.mjs` 只读 `nx-mk run` 的产物做断言，**不自己重算覆盖率** ——
100% 的账本只有 `coverage-report.json` 与 `coverage.db` 一处。

## 实测验收输出

采集（`node ../../packages/cli/dist/index.js run`，退出码 **0**）：

```
✔ Run run_20261008_114636 completed in 3974ms
  Logs: .nx-mk/runs/run_20261008_114636/
  Coverage: required 100% | effective 100% | raw backend 100%
  missing required: 0 | ignored returned: 0 | suspicious: 0
  Report: .nx-mk/coverage-report.json
  Generated DSL: .nx-mk/runs/run_20261008_114636/dsl.generated.yml (5 requests, 5 with status expect)
```

验收（`node verify-coverage.mjs`，退出码 **0**）：

```
[verify] 场景结果: commerce-orders-full=pass
[verify-coverage] 断言 A–H 全过 —— requiredCoverage=1 (100%) ✅
```

旁路复算（`node verify-scan.mjs`，退出码 **0**）：扫描 85 个 `[data-mk-field]` →
有效 evidence 85 条，42 条路径 `requiredCoverage 1.0000（42/42）`，无 weak、无 invisible。

`coverage-report.json` 的 metrics（run `run_20261008_114636` 实测）：

| 指标 | 实测值 |
|---|---|
| `requiredCoverage` | **1** |
| `effectiveCoverage` | 1 |
| `rawBackendFieldCoverage` | 1 |
| `fieldsTotal` / `requiredFields` | 44 / 44 |
| `missingRequiredFields` | 0 |
| `suspiciousFields` | 0 |
| `endpointsCalled` | 4 / 4 |
| `weakEvidenceFields` | `[]` |
| `ignoredReturnedFields` | `[]` |

`coverage.db` 三表（**按本次 run_id 收窄**，非全表）：

| 表 | 行数 |
|---|---|
| `runs`（本次） | `status=completed`，`terminated_by=goal-met` |
| `field_hits` | 51（42 条互异 `normalized_path` 全命中 + 跨请求聚合） |
| `ui_evidence` | 42（42 条互异 `field_path`，与分母逐条对上） |
| `request_traces` | 10 |

场景套件：`commerce-orders-full`，48 步（`goto`×1 + `waitFor`×4 + `assertFieldVisible`×42 +
`screenshot`×1）。42 个 `field` 字面量与 manifest 的 42 条唯一 `normalizedPath`
**逐字相等**（脚本实测：页面字面量集 ≡ 场景断言集 ≡ manifest 唯一路径集；
`verify-manifest.mjs` 的双向断言独立验证「REQUIRED ≡ manifest」这一环）。

`request_traces` 的 10 行 = 5 个 endpoint 调用 × 2 —— React 18 StrictMode 开发模式
effect 双调用（`listProducts` / `listOrders` / `getOrder`×2 / `createOrder` 各两次），
两个实例的 trace 都入库，取最差质量后仍 valid。五个调用全部带真实 `endpoint_id`
（`matchEndpoint` 命中）与 `scenario_id=commerce-orders-full` 归因。

## 口径说明

- **envelope 分区渲染（spec §9）**：`data.total` / `data.page` / `data.pageSize` / `data.hasNext`
  是 envelope 标量，必须渲染在**数组循环外**（`ProductList` 顶部的汇总区）。写进 `.map` 里
  会变成 `data.items[].total` 之类的路径 —— 匹配不到任何 manifest 字段，直接 missing。
- **P1**：coverage 分母只含响应字段。`listProducts` 的 query 参数 `page`/`pageSize` 不进分母；
  `createOrder` 的请求体 `sku`/`quantity` 同理 —— 改用 **201 回显**设计：响应体回显
  `{ id, status, totalAmount, placedAt }`，页面渲染 `data.*` 四条路径。
- **对象级父描述符**：`schema-walker` 对 plain object 属性产父描述符（`data.items[].supplier`、
  `data[].shipping`、`data[].shipping.address`、`data[].payment` 各占分母一条），对
  array-of-object **不**产（`data[].items` 不在分母里）。故四条父路径各渲染一个**叶子摘要**
  Field（如 `（sup_01 · 宁波精密制造 · 华东）`），不能是空 span 或裸 JSON —— 空 span 踩 A1。
- **深层数组两种形态**：`data.items[].tags[]`（envelope→元素→**标签数组**，array-of-primitive
  带 `[]` 后缀，`join(' / ')` 渲染）与 `data[].items[].sku` 等（订单→**行项数组**→叶子）互补。
- **A1/A2**：所有 Field 的 children 都过占位符兜底（`'—'`），保证 span 内恒有非零可见文本。
  三个 nullable 验证点全部真实走到：`ord_002` 的 `shipping.address.line2=null` 与
  `payment.paidAt=null`（列表区）、`getOrder` 恒回的 `note=null`（详情区）—— 运行时各渲染
  一次 `'—'`（verify-scan 的 textSample 里可见）。字符串用 `||`、数值用 `??`（`quantity=0`
  是合法值，`||` 会吞成 `'—'` 失真）。
- **A3**：enum/字典映射中文标签（`paid→已付款`、`alipay→支付宝`、`CNY→人民币`），
  局部变量带 `Text` 后缀，不取字段名末段。
- **A4**：`data.id` / `data.status` 同时是 `getOrder` 与 `createOrder` 的 manifest 字段，
  analyzer 按 `normalizedPath` 单独索引并取最差质量 —— `OrderList` 详情区与 `CheckoutForm`
  的渲染质量互相绑定。两处 children 均为 valid，无相互拖累。`data.total`（envelope 标量）
  与 `data[].totalAmount`（列表元素）是**不同路径**，互不相干。
- **详情区必须真实请求（controller 裁定）**：`GET /orders/{orderId}` 的四条路径若没有页面
  发起该请求，运行期零 evidence → 断言 B/C 必失败。`OrderList` 的第二个 `useEffect` 对
  `DETAIL_ORDER_IDS = ['ord_001', 'ord_002']`（镜像 server 的 ORDERS fixture）逐个取详情，
  渲染进独立 DOM 区 `<div data-testid="order-detail">`。`verify-pages.mjs` 的挂载断言解析
  server 源码的 fixture 块，逐 id 核对页面里存在对应字面量 —— fixture 增删立即变红。
- **S2/S4/S5**：场景 DSL 只有 `goto`/`waitFor`/`waitForRequest`/`assertFieldVisible`/`screenshot`
  五种 step，无 `click`/`fill`；整页导航会重置 collector 缓冲，故场景只含**一个** `goto`
  （`verify-coverage.mjs` 静态断言）；步数上限 50，本套件 48 步。
- **两个订单都覆盖**：列表区渲染全部 fixture 订单 —— `ord_002` 是双 nullable 的唯一载体；
  详情区对两个订单各取一次 —— `note=null` 分支真实走到。固定只取 `ord_001` 会让这些分支
  在运行时永远走不到，A1/A2 防护退化为「构造正确但无法观测」。
- **S3（套件是子集）**：`assertFieldVisible` 只要有**一个** `[data-mk-field="X"]` 可见即过。
  真正的门是 `verify-coverage.mjs` 的断言 B/C/D/E —— 以 `coverage-report.json` 为准，G 不能替代之。

## 已知限制

本次验证未发现 nx-mk 核心能力缺口。以下是**设计取舍与复现前置条件**，记录以免后人误判：

0. **`swagger/openapi.json` 不入库**（项目 `.gitignore` 忽略派生 spec）。
   全新 clone 必须先跑 `pnpm orders:openapi`，否则 `nx-mk run` 以
   `PLUGIN_HOOK_FAILED`（ENOENT）退出。本 README 的步骤 2 就是它 ——
   实测：删掉 spec 与 `.nx-mk/` 后按本文步骤重跑，可复现上述全部数字。
1. **`generateSdk` 丢弃可空性** —— spec 声明 `line2: string | null`，生成类型却是 `line2: string`
   （`paidAt` / `note` 同）。TS 不会提醒 null 防护，故组件里的 `|| DASH` 兜底是刻意写的，
   不依赖类型系统。
2. **对象级 required 字段** —— 同「口径说明」第 3 条：四条父路径（`supplier` / `shipping` /
   `shipping.address` / `payment`）不渲染自身路径的 Field，requiredCoverage 到不了 1。
3. **场景结果不落 `scenarios.json`** —— `plugin-playwright` 只把 `scenario:done` 事件
   emit 进 `.nx-mk/runs/<runId>/events.jsonl`，且**场景失败不影响进程退出码**（只 warn）。
   故断言 G 必须解析事件流；「run 退出码 0」不能代表场景全过。
4. **`swagger/openapi.json` 与全部 `dist/` 都不入库**（派生产物）——
   全新 clone 必须先跑上面步骤 1 的构建与步骤 2 的 spec 生成。缺任一步，
   `nx-mk run` 会以 ENOENT / `PLUGIN_HOOK_FAILED` 退出。
5. **⚠️ 已知的活口：验收靠人记得重跑。** `pnpm orders:verify-full`
   （= `verify-pages` + `verify-scan` + 本门）**没有任何东西会自动调用它** ——
   第一个（`verify-pages`）是纯静态、只需要 `.nx-mk/manifest.json`，不需要服务；
   第二个（`verify`）会链到 `orders:scan`，它要起 chromium 打 5202，同样需要两个服务。
   也就是说三个都不需要采集、但后两个需要服务 —— 真正能发现「采集其实已经失败」的
   只有本门（断言 A-0 比对报告与 runs 最新行）。
   断言 A-0 能拦住「陈旧报告冒充最新一次 run」，但前提是**有人跑了它**。
   在 Task 7 定下 CI 形态之前，重跑验收请显式执行：

   ```bash
   pnpm orders:verify-full
   ```

   陈旧性为什么危险：一次失败的采集**不会删除**上一次成功的报告
   （`coverage-report.json` 只在成功路径写），只看磁盘上「有报告、指标是 100%」
   会得到一个已被推翻的结论。
6. **⚠️ 孤儿 vite 端口劫持 → 采集通道静默双黑洞（本项目实测踩中，2026-10-08）。**
   vite 的 `define` 机制（`__MK_ANALYSIS__` 经页面全局注入）本身可靠；踩坑的形状是：
   一个**没带 `MK_ANALYSIS=true`** 的旧 vite 进程占着 5202（pnpm 停后台任务后 node
   子进程常存活），新起的 vite 静默换端口（banner 打 5203），`nx-mk run` 扫到的是孤儿。
   此时**三指标照样全绿、场景照样 pass**（DOM 扫描通道不依赖 analysis 模式），只有断言 H
   （`field_hits` / `request_traces` 为空）能拦住 —— 而它的报错只有「采集没落数据」六个字。
   双黑洞的机理：SDK 的 fetch 包装发请求前置 `__MK_SDK_INFLIGHT__` 标记**不分模式**，
   shim 的 fetch 兜底补丁见标记就跳过（以为 SDK 会上报），而 production 分支根本不上报
   —— 两条通道同时哑掉。排查手段已内置进 `verify-scan.mjs`：页面全局
   `__MK_ANALYSIS__` 不为 `true` 时直接抛出含 端口核对与 netstat 定位步骤的报错，
   不必从断言 H 从零猜起。预防动作就一条：**每次起 vite 后核对 banner 端口**。

## 配套校验脚本

| 脚本 | 层 | 作用 |
|---|---|---|
| `verify-pages.mjs` | 静态 | 页面 `field` 字面量是否都在 manifest 的 `normalizedPath` 集合内；DASH 兜底是否存在；fixture 订单 id 的详情请求挂载断言 |
| `verify-manifest.mjs` | 静态 | manifest 双向等值（页面渲染的路径 ↔ manifest 路径，42 条） |
| `verify-scan.mjs` | 旁路 | 真浏览器 + 生产 `classifyEvidence` 复算一遍比值（**不落产物**，故不能替代验收门）；含 `__MK_ANALYSIS__` 模式前置自检 |
| `verify-coverage.mjs` | **门** | 只读 `nx-mk run` 产物，断言 A–H（含 A-0 陈旧报告防护） |

前三者都不读 `coverage-report.json`，因此都不能证明 100% —— 只有第四个能。
