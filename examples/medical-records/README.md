# medical-records（验证项目一）

形状族：**对象嵌套 / $ref 复用 / enum / nullable / 数组内嵌数组**

三个 endpoint，全部由单页自驱动渲染：

| endpoint | 方法 | 路径 | manifest 路径数 |
|---|---|---|---|
| `getPatient` | GET | `/patients/{patientId}` | 16 |
| `listPatientVisits` | GET | `/patients/{patientId}/visits` | 11 |
| `createPatient` | POST | `/patients` | 3 |

30 条 manifest 字段里 `data.id` / `data.name` 被两个 endpoint 共用，故**唯一路径 28 条**
（A4 跨 endpoint 取最差质量，见下文「口径说明」）。

## 启动与验收

```bash
# 0. 依赖
pnpm install && npx playwright install chromium

# 1. 后端（8801）
pnpm --filter @nx-mk-example/medical-server dev

# 2. 前端（5201）—— MK_ANALYSIS 必须给 vite 进程，不是给 CLI
MK_ANALYSIS=true pnpm --filter @nx-mk-example/medical-app dev

# 3. 采集 + 验收（项目目录内）
cd examples/medical-records
node ../../packages/cli/dist/index.js run
node verify-coverage.mjs
```

`verify-coverage.mjs` 只读 `nx-mk run` 的产物做断言，**不自己重算覆盖率** ——
100% 的账本只有 `coverage-report.json` 与 `coverage.db` 一处。

## 实测验收输出

采集（`node ../../packages/cli/dist/index.js run`，退出码 **0**）：

```
✔ Run run_20261005_045222 completed in 3963ms
  Logs: .nx-mk/runs/run_20261005_045222/
  Coverage: required 100% | effective 100% | raw backend 100%
  missing required: 0 | ignored returned: 0 | suspicious: 0
  Report: .nx-mk/coverage-report.json
  Generated DSL: .nx-mk/runs/run_20261005_045222/dsl.generated.yml (5 requests, 5 with status expect)
```

验收（`node verify-coverage.mjs`，退出码 **0**）：

```
[verify] 场景结果: medical-patient-full=pass
[verify-coverage] 断言 A–H 全过 —— requiredCoverage=1 (100%) ✅
```

`coverage-report.json` 的 metrics（run `run_20261005_045222` 实测）：

| 指标 | 实测值 |
|---|---|
| `requiredCoverage` | **1** |
| `effectiveCoverage` | 1 |
| `rawBackendFieldCoverage` | 1 |
| `fieldsTotal` / `requiredFields` | 30 / 30 |
| `missingRequiredFields` | 0 |
| `suspiciousFields` | 0 |
| `endpointsCalled` | 3 / 3 |
| `weakEvidenceFields` | `[]` |
| `ignoredReturnedFields` | `[]` |

`coverage.db` 三表（**按本次 run_id 收窄**，非全表）：

| 表 | 行数 |
|---|---|
| `runs`（本次） | `status=completed`，`terminated_by=goal-met` |
| `field_hits` | 33 |
| `ui_evidence` | 28（28 条互异 `field_path`，与分母 28 逐条对上） |
| `request_traces` | 10 |

场景套件：`medical-patient-full`，33 步（`goto`×1 + `waitFor`×3 + `assertFieldVisible`×28 + `screenshot`×1）。
28 个 `field` 字面量与 manifest 的 28 条唯一 `normalizedPath` **逐字相等**（脚本实测集合相等）。

`request_traces` 的 10 行 = 5 个 endpoint 调用 × 2 —— React 18 StrictMode 开发模式 effect 双调用，
两个实例的 trace 都入库，取最差质量后仍 valid。

## 口径说明

- **P1**：coverage 分母只含响应字段。本项目 `GET /patients/{patientId}` 的路径参数
  `patientId` 不进分母，页面不渲染它。`POST /patients` 的请求体字段同理 ——
  改用 **201 回显**设计：响应体回显写入的 `name`，页面渲染同一 `data.name` 路径。
- **A1/A2**：所有 Field 的 children 过 `?? '—'` 兜底（`notes` 可为 null、空 medications 数组）。
  字符串用 `||`、数值用 `??` —— 后者的 `0` 是合法测量值，`||` 会把 `heartRate=0` 吞成 `—`。
- **A3**：enum 映射中文标签（`female→女`、`O→O 型`）、布尔渲染「在服用/已停用」，均不等于字段名末段。
  三个嵌套对象（`data.contact` / `data.emergencyContact` / `data.insurance`）渲染**叶子摘要**
  而非空 span 或裸 JSON —— 空 span 会踩 A1（比不渲染更糟：既丢覆盖又进 suspicious）。
- **P3**：数组路径用 `data[].medications[].name` 归一化形态，非下标形态。
- **A4**：`data.id` / `data.name` 同时是 `getPatient` 与 `createPatient` 的 manifest 字段，
  analyzer 按 `normalizedPath` 单独索引并取最差质量，故 `NewPatientForm` 的渲染质量
  同时决定 `PatientDetail` 那两条的质量。两处 children 均为 valid，无相互拖累。
- **S2/S4**：场景 DSL 只有 `goto`/`waitFor`/`waitForRequest`/`assertFieldVisible`/`screenshot`
  五种 step，无 `click`/`fill`；且整页导航会重置 collector 缓冲。故单页自驱动渲染全部视图，
  场景只含**一个** `goto`（`verify-coverage.mjs` 静态断言）。
- **两个患者都渲染**：`main.tsx` 挂 `p_001` 与 `p_002` 两个实例。`p_002` 是 `notes=null`
  与 `medications=[]` 两个验证分支的唯一载体 —— 固定请求 `p_001` 会让这两个分支在运行时
  永远走不到，A1/A2 防护只能靠构造正确性成立、无法被观测。
- **S3（套件是子集）**：`assertFieldVisible` 只要有**一个** `[data-mk-field="X"]` 可见即过。
  真正的门是 `verify-coverage.mjs` 的断言 B/C/D/E —— 以 `coverage-report.json` 为准，G 不能替代之。

## 已知限制

本次验证未发现 nx-mk 核心能力缺口。以下三点是**设计取舍**而非缺口，记录以免后人误判：

1. **`generateSdk` 丢弃可空性** —— spec 声明 `notes: string | null`，生成类型却是 `notes: string`。
   TS 不会提醒 null 防护，故三个组件里的 `|| DASH` 兜底是刻意写的，不依赖类型系统。
2. **对象级 required 字段** —— `schema-walker` 对 plain object 属性会产父描述符
   （`data.contact` 本身是 `type:object, required:true` 的独立字段，进分母），
   对 array-of-object **不**产（`data[].medications` 不在分母里）。故普通嵌套对象必须额外
   渲染自身路径的 Field，否则 requiredCoverage 到不了 1。
3. **场景结果不落 `scenarios.json`** —— `plugin-playwright` 只把 `scenario:done` 事件
   emit 进 `.nx-mk/runs/<runId>/events.jsonl`，且**场景失败不影响进程退出码**（只 warn）。
   故断言 G 必须解析事件流；「run 退出码 0」不能代表场景全过。

## 配套校验脚本

| 脚本 | 层 | 作用 |
|---|---|---|
| `verify-pages.mjs` | 静态 | 页面 `field` 字面量是否都在 manifest 的 `normalizedPath` 集合内；DASH 兜底是否存在 |
| `verify-manifest.mjs` | 静态 | manifest 双向等值（页面渲染的路径 ↔ manifest 路径） |
| `verify-scan.mjs` | 旁路 | 真浏览器 + 生产 `classifyEvidence` 复算一遍比值（**不落产物**，故不能替代验收门） |
| `verify-coverage.mjs` | **门** | 只读 `nx-mk run` 产物，断言 A–H |

前三者都不读 `coverage-report.json`，因此都不能证明 100% —— 只有第四个能。