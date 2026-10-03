# nx-mk 多域真 100% 覆盖率验证项目 —— 设计 spec

**日期**：2026-10-03
**状态**：待评审
**关联**：`docx/plan/nx-mk-plan.md` §47（Phase 5 / 交付验证）、§26（Scenario DSL）

---

## 1. 目标与非目标

### 1.1 目标

回答一个交付级问题：**nx-mk 的完整 pipeline（OpenAPI → manifest → 采集 → coverage 分析），
在不同业务域与不同 OpenAPI 形状下，能否让 agent 产出的前端达到 requiredCoverage = 100%
（`missingRequiredFields === 0`），且 `coverage.ignored` 尽量清空？**

具体交付：3 个入 git 的完整可跑项目，每个含自己的后端（真实 HTTP 服务）、自己的 OpenAPI 描述、
自己的前端页面（真实渲染 + `data-mk-field` 标记）、自己的场景套件与 `nx-mk.config.yml`。
任何人 clone 仓库后能逐个 `nx-mk run` 复现 100%。

### 1.2 非目标

- 不修改 nx-mk 核心包的行为。本 spec 只**消费**既有能力；发现的能力缺口记入验证报告，
  是否修由后续独立 SDD 决定。
- 不引入 GraphQL / gRPC 后端。manifest pipeline 是 OpenAPI 驱动的（`@nx-mk/manifest`
  只解析 `config.openapi`），无其他协议通道。
- 不追求三个项目之间的代码 DRY（见 §6 方案论证）。

### 1.3 与现有 demo 的关系

`examples/react-vite-demo` **保持不动**，作为对照基线：它有 7 条 `coverage.ignored`
校准历史、`rawBackendFieldCoverage ≈ 36%`，代表"现实中常见的未达标形态"。
新三项目代表"理想对齐形态"。两者并列，让 100% 这个数字有参照系而非孤立断言。

---

## 2. 已验证的管道约束（设计前提，实现时以代码为准复核）

以下四条是本次设计的硬约束，均来自对现有实现代码的阅读，不是假设：

| # | 约束 | 代码依据 | 对设计的影响 |
|---|---|---|---|
| C1 | **请求体字段不进 coverage 分母**。manifest 只把响应字段展平进 `Manifest.fields`；`requestBody` 仅记类型引用。路径参数 / query / header 会进。 | `packages/manifest/src/parser.ts:121`（`allFields.push(...responseFields) // 展平进 Manifest.fields（仅响应字段）`） | 写接口必须"回显设计"（§3.2），否则写入值无法被覆盖 |
| C2 | **SDK 对非 2xx 直接 throw，响应体不解析**。 | `packages/client/src/runtime/client.ts:177`（`if (!res.ok) throw new Error(...)`） | 错误响应体字段必须走原生 fetch 路径，且后端错误体须包在 `data.*` 下才可渲染 |
| C3 | **数组元素路径归一化为 `[]` 后缀**。运行时 `orders.0.items.2.sku` → `orders[].items[].sku`。 | `packages/manifest-schema/src/schema-walker.ts:57-60` + `normalizer.ts:4-9` | 数组字段的 page `data-mk-field` 必须写 `[]` 形态，不是下标形态 |
| C4 | **endpointId 走 sha1(method:path) 前 12 位**，正常路径下可匹配（demo 的 `'unknown'` 是 fallback，非常态）。 | `packages/manifest/src/parser.ts:64` | 场景套件的 URL 必须与 OpenAPI path 逐字对齐，否则采集归因失败 |

---

## 3. 三个项目的形状设计

三项目按 OpenAPI **形状族**分化，每个覆盖一组不同的路径构造难点。业务域刻意选得互不相干，
避免"同一个模型换皮"式验证。

### 3.1 项目一：medical-records（嵌套关联 + enum + nullable）

**验证目标**：对象嵌套、一对一关联、`$ref` 复用、enum、nullable、可选字段的路径归一化与覆盖。

| Endpoint | 方法 | 响应形状 | 覆盖难点 |
|---|---|---|---|
| `/api/patients/{patientId}` | GET | `data.id / name / birthDate(date) / gender(enum) / bloodType(enum) / contact.phone / contact.email / emergencyContact.name / insurance.policyNumber / insurance.expiryDate(date) / lastVisitAt(date-time) / notes(string\|null)` | 嵌套对象 `data.contact.*`；`$ref` 复用 Contact（患者 + 监护人两处用同一 schema）；nullable `data.notes`；enum 值需全部映射到 UI |
| `/api/patients/{patientId}/visits` | GET | `data[]: { id, visitAt(date-time), department(enum), diagnosis, vitals{ heartRate(int), heightCm(number), weightKg(number) }, medications[]: { name, dosage, prescribed } }` | 数组元素嵌套 + 数组内再嵌数组（`data[].medications[]`），C3 双层归一化 |
| `/api/patients` | POST | 201 → `data.id / data.name / data.createdAt` | **回显设计**（C1）：写入 patient 的 name 在响应体回显，页面渲染同一 fieldId |
| `/api/patients/{patientId}` | DELETE | 204（无 body） | 无响应字段 —— 验证空响应处理 |

**页面**：
- `PatientDetail.tsx` — 详情页渲染患者全部字段（`data-mk-field` 逐字段标记，含 enum 映射与 `notes` 的 null 分支）
- `VisitHistory.tsx` — 访问记录列表，`.map()` 渲染数组元素每个字段（**每个数组元素都带同一 `data-mk-field`**，归一化后 `data[].*` 命中）
- `NewPatientForm.tsx` — 新建表单，提交后渲染 201 回显对象

### 3.2 项目二：commerce-orders（分页 envelope + 深层数组）

**验证目标**：分页 envelope（`data.items[]` + `data.total` / `data.page` / `data.pageSize` / `data.hasNext`）、
数组内嵌对象、三层嵌套、query 参数分页（验证 query 参数也能被覆盖）。

| Endpoint | 方法 | 响应形状 | 覆盖难点 |
|---|---|---|---|
| `/api/products?page=&pageSize=` | GET | `data.items[]: { id, sku, name, price(number), currency(enum), category, tags[]: string, supplier{ id, name, region } }` + `data.total(int) / data.page(int) / data.pageSize(int) / data.hasNext(bool)` | 分页 envelope 四字段 + `data.items[]` 双层结构 + `data.items[].tags[]` 三层数组；`data.items[].supplier.*` 对象嵌套 |
| `/api/orders` | GET | `data[]: { id, status(enum), placedAt, totalAmount(number), currency, items[]: { sku, name, unitPrice, quantity(int), lineTotal }, shipping{ recipient, address{ line1, line2(string\|null), city, postalCode, country } }, payment{ method(enum), paidAt(date-time\|null) } }` | 三层数组（`data[].items[]`）+ 数组内对象嵌套 + 可空字段 `line2` / `paidAt` |
| `/api/orders` | POST | 201 → `data.id / data.status / data.totalAmount / data.placedAt` | 回显设计 |
| `/api/orders/{orderId}` | GET | `data.id / data.status / data.customerName / data.note(string\|null)` | 单对象 + nullable |

**页面**：
- `ProductList.tsx` — 分页列表，渲染 envelope 四字段 + 每个商品全部字段（分页切换按钮触发多次请求）
- `OrderList.tsx` — 订单列表，渲染每个订单的全部嵌套字段
- `CheckoutForm.tsx` — 下单表单 → 渲染 201 回显

### 3.3 项目三：devops-incidents（错误响应体 + 混合状态码）

**验证目标**：这是最有意思的一个 —— 验证**非 2xx 响应体字段能否真被采集**（绕过 C2 的 SDK throw 路径），
以及多状态码 endpoint（同一 path 有 200 / 404 / 500 三个响应 schema）。

| Endpoint | 方法 | 响应形状 | 覆盖难点 |
|---|---|---|---|
| `/api/services` | GET | 200 → `data[]: { id, name, status(enum), region, version, dependencies[]: string, lastDeployedAt(date-time) }` | 正常路径 + 依赖数组 |
| `/api/services/{serviceId}/incidents` | GET | 200 → `data[]: { id, title, severity(enum), state(enum), openedAt, resolvedAt(date-time\|null), assignee{ id, name, email }, impact{ usersAffected(int), regions[]: string } }` | 数组 + 双对象嵌套 + nullable |
| `/api/services/{name}/health` | GET | **200** → `data.status(enum) / data.checks[]: { name, passed(bool), latencyMs(int), message }`；**503** → `data.code(enum) / data.message / data.retryAfterSeconds(int) / data.contact` | **多状态码同 path**。503 分支必须由**原生 fetch** 取响应体并渲染错误卡（C2 绕行） |
| `/api/incidents/{incidentId}/notes` | POST | 201 → `data.id / data.body / data.createdAt` | 回显设计 |

**页面**：
- `ServiceList.tsx` — 服务列表
- `IncidentList.tsx` — 事件列表
- `HealthChecker.tsx` — **健康检查页**：输入服务名 → fetch `/health` → 若 503，渲染错误卡
  （`data.code` / `data.message` / `data.retryAfterSeconds` / `data.contact`），若 200 渲染检查项。
  这是全项目组唯一的"错误分支渲染"实现，也是 C2 绕行的唯一验证点。

---

## 4. 每个项目的标准构成（与现有 demo 同构）

```
examples/<domain>-<shape>/
├── nx-mk.config.yml        # openapi 段 + collect.url + goal + coverage(required 空/ignored 空) + scenarios.include
├── swagger/openapi.json    # 由 server 的 generate-openapi 脚本产出（demo 同构：pnpm <domain>:openapi）
├── server/                 # Hono + zod-openapi，package.json name @nx-mk-example/<domain>-server
│   ├── package.json
│   ├── tsconfig.json
│   └── src/{index.ts, generate-openapi.ts}
├── app/                    # React + Vite + SDK Facade
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── tsconfig.json
│   └── src/{main.tsx, *.tsx 页面, generated-sdk.ts}
└── mk/scenarios/*.yml      # 场景套件（§26 DSL）
```

### 4.1 关键配置约定

- `coverage.ignored: []` —— **空列表**。这是"真 100%"的硬约束：任何字段若无法渲染，
  都是设计缺陷而非豁免。
- `coverage.required: []` —— 空 = 全字段 required（现有 demo 语义）。分母 = manifest 全部响应字段。
- `goal.targetRatio: 1.0` —— Goal Loop 以 100% 为终止条件。
- `collect.maxTurns: 5` —— 场景套件模式下由套件驱动，此值仅作兜底。
- 端口：每个项目 server 与 app 各用独立端口（见 §7 端口分配），避免三项目并存时冲突。

### 4.2 场景套件约定

每个项目一套场景，每字段一个 `assertFieldVisible` 断言（或一个断言覆盖同元素的多个字段）。
套件是**验证主力**：失败时直接指出哪个字段没渲染，无需人工读 coverage-report。

`assertFieldVisible` 的 `field` 值必须用 **manifest 归一化路径**（数组元素用 `[]`），C3。

---

## 5. 验收标准

一个项目"通过"当且仅当以下全部成立：

1. `nx-mk run` 退出码 0，Goal Loop 以 `goal:met` 终止（`runs.terminated_by === 'goal-met'`）
2. `coverage-report.json` 中 `metrics.requiredCoverage === 1`
3. `metrics.missingRequiredFields === 0`
4. `metrics.suspiciousFields === 0`（anti-cheat 无告警 —— 页面不能靠 hidden DOM 或空标记刷覆盖率）
5. `coverage.ignored` 为空数组（§4.1）
6. 场景套件全部步骤通过，无 `assertFieldVisible` 失败
7. `db` 三表（`field_hits` / `ui_evidence` / `request_traces`）均非空
8. 项目 README 记录：`rawBackendFieldCoverage` / `effectiveCoverage` 实测值 + 已知限制

**汇总**：三项目全通过 = 本 spec 完成。任一项目不通过 = 记录缺口清单（哪个 shape、哪类字段、
是 nx-mk 能力缺口还是项目设计缺陷），不降标准、不加 ignored 绕过。

---

## 6. 方案论证（为何手写三份而非生成器）

**考虑过的方案**：

- **A. 三项目同构手写**（采用）：复用现有 demo 已验证的 Hono+zod-openapi + React/Vite + SDK codegen
  链路，各手写 domain 模型与页面。
- **B. 骨架生成器 + domain 描述文件**（否决）：一次调试产出三项目，但生成器本身 ~300 行新代码
  需独立测试，把"验证工具"变成"另一个待维护产品"，模糊验证目标；且生成产物不可直读，
  调试时需阅读生成结果。
- **C. 手写一个 + 复制改造两个**（否决于 A）：介于两者之间，但复制来的代码仍需逐个改 shape，
  重复劳动与 A 相当，却失去 A 的"三项目各自独立可读"价值。

**A 的取舍**：三份 server/app 有约 60% 骨架结构重复。这是**有意的**：本次目标是验证
nx-mk 的能力边界，不是验证代码 DRY。结构重复是一次性成本、可读性高、且每个项目的
domain 差异足够大（嵌套 vs 分页 vs 错误分支），实际重复度低于名义值。

---

## 7. 端口分配（三项目可并存，便于交叉验证）

| 项目 | server | app |
|---|---|---|
| medical-records | 8801 | 5201 |
| commerce-orders | 8802 | 5202 |
| devops-incidents | 8803 | 5203 |
| （现有 demo） | 8787 | 5173 |

---

## 8. 实施节奏（分两批）

- **批次一**：项目一（medical-records）完整跑通真 100%，把踩到的坑写入其 README。
  确认形状设计可行后再启动批次二。
- **批次二**：项目二（commerce-orders）、项目三（devops-incidents）。
  项目三的错误分支渲染（§3.3 / C2 绕行）风险最高，放在最后，前面两项目的经验能降低其调试成本。

---

## 9. 风险与已知不确定

| 风险 | 影响 | 应对 |
|---|---|---|
| C2 绕行（503 响应体采集）未经验证 —— 原生 fetch 是否被 collector 观测到取决于 shim 的 `pathname` 前缀匹配（scanner.ts:132 只观测 `/api` 前缀） | 项目三可能无法达成 100% | 项目三的 503 分支用**经 `/api` 前缀的原生 fetch**（不用其他路径前缀）；批次二启动时先做一个最小 spike 验证 |
| demo 已知短板"整页导航重置 `window.__MK_COLLECTOR__` 缓冲"在新项目重现 | 场景套件的 `goto` 步骤若触发整页导航，未回捞的 hits 丢失 | 场景套件用单页应用 + 客户端路由（`goto` 只进首页，后续用交互步骤切换视图），避开整页导航 |
| anti-cheat 把真实但简单的渲染判为 suspicious | 验收标准 4 失败 | 渲染必须真实呈现可见文本；`data-mk-field` 元素需有非空可见内容 |
| 枚举字段的"全部值覆盖"要求可能不现实（后端只返回部分枚举值） | enum 字段实际未被覆盖 | **裁定：enum 字段只需覆盖一个实际出现的值** —— coverage 语义是"字段路径被渲染"，非"枚举全集被渲染"。spec §5.4 不涉及此项 |
| `data.hasNext` / `data.pageSize` 这类**标量 envelope 字段**需与数组元素字段区分渲染位置 | 误把标量字段挂进数组循环导致 `data[].page` 错路径 | 页面结构：envelope 标量字段渲染在列表容器外的 summary 区 |

---

## 10. 文档产物

每个项目一份 `README.md`，含：
- 业务域与形状族说明
- 启动步骤（构建依赖顺序 → 起 server → 起 app（`MK_ANALYSIS=true`）→ `nx-mk run`）
- 验收断言的实测输出（coverage 三指标 + goal:met + 场景结果）
- 该项目暴露的 nx-mk 已知限制

仓库根 `README.md` 追加一节，列出三项目与现有 demo 的对照表（形状族 / 字段数 / requiredCoverage /
ignored 数 / 已知限制）。

---

## 11. 自检（spec 内部一致性）

- §2 的四条约束全部有代码行号依据，无假设
- §3 三项目的 endpoint 形状与 §4.1 的 `coverage.ignored: []` 无矛盾（每个响应字段都在页面里有渲染位置）
- §5 验收标准与 §3 各项目的验证目标一一对应，无遗漏形状
- §9 已裁定 enum 覆盖语义，避免实现期歧义
- 无 TBD / TODO / 占位符