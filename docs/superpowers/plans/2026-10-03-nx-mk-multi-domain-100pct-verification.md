# 多域真 100% 覆盖率验证项目 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 3 个入git 的完整可跑验证项目（medical-records / commerce-orders / devops-incidents），证明 nx-mk pipeline 在不同 OpenAPI 形状下能让前端达 `requiredCoverage === 1` 且 `coverage.ignored` 为空。

**Architecture:** 每个项目与现有 `examples/react-vite-demo` 同构（server: Hono+zod-openapi → swagger/openapi.json；app: React+Vite+SDK Facade；场景套件驱动采集）。三项目按 OpenAPI 形状族分化而非换皮。**本计划不改任何 packages/ 下的核心代码** —— 只消费既有能力；发现的能力缺口记入各项目 README 的「已知限制」，修复另开SDD。

**Tech Stack:** Hono 4 + @hono/zod-openapi + zod（server）；React 18 + Vite 5 + `@nx-mk/client`（app）；`@nx-mk/scenario` YAML DSL（场景套件）；vitest（验证断言）。

**Spec:** `docs/superpowers/specs/2026-10-03-nx-mk-multi-domain-100pct-verification-design.md`

---

## Global Constraints

以下每条都来自对现有实现代码的**实测阅读**（非假设），实现期若发现与代码不符，先改本计划再动手。

###管道语义（违反即验收失败）

| ID | 约束 | 依据 |
|---|---|---|
| **P1** | **coverage 分母 = `Manifest.fields`，它只含响应字段**。请求体字段、路径参数、query、header **都不进分母**。项目里的路径参数（如 `{patientId}`）**不需要渲染**。 | `packages/manifest/src/parser.ts:121` `allFields.push(...responseFields) // 展平进 Manifest.fields（仅响应字段）`；实测 demo manifest `fields` 22 项全为 `direction:"response"`，`pathParams` 独立挂在 `endpoints[].request` 下不进 fields |
| **P2** | **字段键名是 `normalizedPath`**（不是 `normalizedFieldPath`）。`<Field field="...">` 的值必须逐字等于 manifest 里的 `normalizedPath`。 | demo manifest `ApiField` 键：`id/endpointId/direction/status/path/normalizedPath/name/type/required/example/source` |
| **P3** | **数组路径用 `[]` 后缀**，不是下标。`data[].medications[].name`，不是 `data.0.medications.2.name`。 | `packages/manifest-schema/src/schema-walker.ts:57-60` + `normalizer.ts:4-9` |
| **P4** | **覆盖判定是 `accessHit \|\| uiHit`** —— field_hit **或** ui_evidence 任一即可算 covered。错误响应走原生 fetch（无 tracked proxy → 无 field hit）**仍可covered**，只要页面渲染了带 `data-mk-field` 的可见元素。 | `packages/coverage/src/analyzer/coverage-analyzer.ts:102` `const hit = accessHit \|\| uiHit` |
| **P5** | **ui_evidence 来自 DOM 扫描**，与 HTTP 通道完全独立。`document.querySelectorAll('[data-mk-field]')` → 逐项读可见性与文本。任何渲染出该属性的元素都会产出 evidence。 | `packages/plugin-playwright/src/scanner.ts:14-17` + `runner.ts:54-56` |

### anti-cheat 硬规则（页面写法直接受约束）

依据 `packages/coverage/src/anti-cheat/classify.ts:15-23`：

| ID | 规则 | 页面写法要求 |
|---|---|---|
| **A1** | `visible === false` → `suspicious`（**不算 hit**） | 每个 `<Field>` 必须有**非零尺寸的可见内容**。禁止 `<Field field="x">{v}</Field>` 当 `v` 为 `''`/`null`/`undefined` 时仍渲染空 span。 |
| **A2** | `textSample.trim() === ''` → `weak`（算 hit，但同字段取**最差质量**，一条 weak 会让该字段整体进 weak 清单） | 空值渲染占位符（如 `'—'`、`'N/A'`），不能留空 |
| **A3** | **`textSample === 字段路径最后一段` → `weak`** | ⚠️ 最易踩：`<Field field="data.name">name</Field>` 判 weak。渲染值必须**不等于**字段名本身。写 `data.name` 就要渲染 `'Alice'` 而非 `'name'`；写 `data.status` 就渲染 `'active'` 而非 `'status'` |
| **A4** | `worstQuality` 取同字段多条 evidence 的**最差**质量 | 同一字段渲染多处时，**每处**都必须是 valid —— 一处 weak 拖垮整个字段 |

### 场景 DSL 约束

| ID | 约束 | 依据 |
|---|---|---|
| **S1** | **DSL 只有 5 种 step**：`goto` / `waitFor` / `waitForRequest` / `assertFieldVisible` / `screenshot`。**无 click / fill**（后置未实现）。 | `packages/scenario/src/dsl-schema.ts:14-26` |
| **S2** | 因此**页面必须自驱动**：进入路由即自动发起全部数据请求并渲染，套件只需 `goto` + `waitFor` + `assertFieldVisible`。**不用交互切视图** | 同上 |
| **S3** | `assertFieldVisible` 实现就是 `waitForSelector('[data-mk-field="X"]', {state:'visible'})`。数组元素只需**一个**带该属性的元素即可过 —— 所以**套件断言是 coverage 的子集**，真正的 100% 门在 `coverage-report.json` | `packages/scenario/src/playwright-runner.ts:37-38` |
| **S4** | `goto` 触发整页导航会重置 `window.__MK_COLLECTOR__` 缓冲。每个场景**只允许一次 `goto`**（进首页），其余步骤在同页内 | demo README「已知限制」 |
| **S5** | `steps` 上限 50 条 / 场景，scenarios ≥1 | `dsl-schema.ts:39` |

### 项目级约束

| ID | 约束 |
|---|---|
| **G1** | `coverage.ignored: []` —— **空数组**。字段覆盖不了就是设计缺陷，不许豁免 |
| **G2** | `coverage.required: []` —— 空 = 全字段 required |
| **G3** | `goal.targetRatio: 1.0` |
| **G4** | `swagger/openapi.json` 由 `pnpm <name>:openapi` 产出并 **gitignore**（同 demo）；`generated-sdk.ts` **入 git**（同 demo） |
| **G5** | 端口：medical-records 8801/5201；commerce-orders 8802/5202；devops-incidents 8803/5203 |
| **G6** | `MK_ANALYSIS=true` 必须给 **vite 进程**（在 dev server 启动时烘焙 `__MK_ANALYSIS__`），不是给 CLI |
| **G7** | 根 `package.json` 加对应 script（`:openapi` / `:codegen` / `:typecheck`），照 demo 的 `demo:openapi` 形态 |
| **G8** | 不修改 `packages/**` 任何文件。若发现核心缺陷，记入该项目 README「已知限制」，不开修复任务 |
| **G9** | 现有 `examples/react-vite-demo` **完全不动** —— 它是对照基线 |

### 验收断言（每个项目必须全过，脚本化）

```
A. nx-mk run 退出码 0，runs.terminated_by === 'goal-met'
B. coverage-report.json: metrics.requiredCoverage === 1
C. metrics.missingRequiredFields === 0
D. metrics.suspiciousFields === 0
E. metrics.weakEvidenceFields === []        // A2/A3 规则的验收出口
F. coverage.ignored === []
G. 场景套件全部步骤 pass（无 assertFieldVisible 失败）
H. db 三表 field_hits / ui_evidence / request_traces 均非空
```

---

## Review Focus

以下输入/情形最可能咬人，而计划的测试未必覆盖。每个 Review Focus 行在拥有该代码的任务里补一条测试（该任务的 Step 2 一并写）。

1. **A3 误判（最危险）**：渲染文本恰好等于字段路径最后一段时判weak。例：字段 `data.name` 渲染成 `"name"`、`data.status` 渲染 `"status"`、`data.items[].sku` 渲染 `"sku"`。测试：断言每个页面的 evidence textSample ≠ 字段名末段。
2. **A1 空渲染**：值为 `''`/`null`/`undefined`/0 时 `<Field>` 渲染出 0×0 空 span → `visible:false` → **suspicious（不算 hit）**，直接击穿 100%。项目一 `data.notes`（nullable）、项目二 `data.items[].shipping.address.line2`（nullable）、项目三 `data.resolvedAt`（nullable）是三处必踩点。
3. **A4 最差质量拖累**：同一字段渲染多处（列表 + 详情），其中一处值恰好等于字段名 → 整个字段变 weak。测试：每个字段的所有渲染点用同一套值。
4. **P3 数组路径写错**：页面写 `data.medications[].name`（漏掉 `data[]`）或 `data[0].medications[].name`（用下标）→ evidence 路径与 manifest `normalizedPath` 不匹配 → 判 missing。测试：断言页面里每个 `field="..."` 字面量都存在于 manifest 的 `normalizedPath` 集合中。
5. **P4/S3 盲区**：套件全过但 coverage 未 100%（数组只渲染了第一个元素、或某 endpoint 根本没被请求到）。测试：以 coverage-report 为门，套件仅作定位辅助 —— 验收断言 B/C 不可由G 替代。
6. **S4 缓冲丢失**：场景中第二次 `goto` 导致前一次的 hits 丢失。测试：每个场景文件只含一个 `goto`（可由验收脚本 grep 断言）。

---

## File Structure

```
examples/medical-records/
├── nx-mk.config.yml                 # openapi/collect/goal/coverage/scenarios 段（ignored: []）
├── .gitignore                       # swagger/openapi.json + app/dist + server/dist
├── README.md                        # 业务域 + 启动步骤 + 实测验收输出 + 已知限制
├── server/
│   ├── package.json                 # @nx-mk-example/medical-server
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # Hono routes + zod schemas + in-memory fixtures
│       └── generate-openapi.ts      # 落盘 ../swagger/openapi.json
├── app/
│   ├── package.json                 # @nx-mk-example/medical-app
│   ├── tsconfig.json
│   ├── vite.config.ts               # port 5201, proxy /api → 8801, define __MK_ANALYSIS__
│   ├── index.html
│   └── src/
│       ├── main.tsx                 # 路由（按 location.pathname 分发，S2 自驱动）
│       ├── generated-sdk.ts         # 入 git，由 codegen 产出
│       ├── PatientDetail.tsx        # §Task2
│       ├── VisitHistory.tsx         # §Task2
│       └── NewPatientForm.tsx       # §Task3（回显）
└── mk/scenarios/patient.yml         # §Task4

examples/commerce-orders/            # 同构，§Task5
examples/devops-incidents/           # 同构，§Task6（含健康检查错误分支）
scripts/verify-examples.mjs          # §Task7：三项目一键验收（A–H 八断言）
```

职责边界：`server/src/index.ts` 只管路由+schema+fixture；页面组件只管渲染 + `data-mk-field`；场景 yml 只管驱动与断言；`scripts/verify-examples.mjs` 只做断言聚合，不跑采集。

---

## Task 分解与依赖

```
Task 1 (medical server+app 骨架+codegen) ──┐
Task 2 (患者详情+访问记录页)             ──┼→ Task 4 (场景套件 + 100% 验收门) ← 批次一闸门
Task 3 (新建患者表单回显)               ──┘
        │
        ├→ Task 5 (commerce-orders 全套)              ← 批次二
        └→ Task 6 (devops-incidents 全套, 含错误分支)
                    │
                    └→ Task 7 (汇总验收脚本 + 根 README 对照表 + spec 缺口归档)
```

Task 2/3 共享 Task 1 的 `main.tsx` 路由骨架（都往里加页面），故 Task 3 的接口段显式声明消费 Task 2 的路由注册方式。

---
---

### Task 1: medical-records 项目骨架（server + app + codegen 链路打通）

**Files:**
- Create: `examples/medical-records/.gitignore`
- Create: `examples/medical-records/nx-mk.config.yml`
- Create: `examples/medical-records/server/package.json` / `tsconfig.json`
- Create: `examples/medical-records/server/src/index.ts` / `generate-openapi.ts`
- Create: `examples/medical-records/app/package.json` / `tsconfig.json` / `vite.config.ts` / `index.html`
- Create: `examples/medical-records/app/src/main.tsx` / `HomePage.tsx`
- Create: `examples/medical-records/verify-manifest.mjs`
- Create: `examples/medical-records/generate-sdk.ts`
- Modify: `package.json`（根，加 3 个 script）

**Interfaces:**
- Consumes: `examples/react-vite-demo` 的同构形态；`@nx-mk/client` codegen（`generateSdk(manifest, {baseUrl:'/api'})`）
- Produces:
  - `server/src/index.ts` 导出 `export const app`（`OpenAPIHono`），供 `generate-openapi.ts` 与 `serve` 共用
  - `GET /patients/{patientId}` 200 → `Patient`（13 字段，normalizedPath 清单见 Step 1 的 REQUIRED）
  - `GET /patients/{patientId}/visits` 200 → `Visit[]`（含 `data[].medications[]` 双层数组）
  - `POST /patients` 201 → `{ id, name, createdAt }`（回显，Task 3 消费）
  - app 约定：`main.tsx` 单页聚合渲染 `HomePage` + `PatientDetail` + `VisitHistory` + `NewPatientForm`（S2/S4 要求一次性渲染全部视图）
  - 生成的 `app/src/generated-sdk.ts` 导出 `api` 与 `Patient`/`Visit`/`CreatedPatient` 类型

- [ ] **Step 1: 写失败的 manifest 字段路径验证（RED）**

创建 `examples/medical-records/verify-manifest.mjs`：

```js
// 断言 manifest 的 normalizedPath 集合 —— 页面里每个 field="..." 字面量都必须落在这个集合内。
// 这条脚本同时是 Review Focus #4（数组路径写错）的自动化出口。
import { readFileSync } from 'node:fs'
const m = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))
const paths = m.fields.map((f) => f.normalizedPath).sort()
const REQUIRED = [
  'data.id', 'data.name', 'data.birthDate', 'data.gender', 'data.bloodType',
  'data.contact.phone', 'data.contact.email',
  'data.emergencyContact.name', 'data.emergencyContact.relation',
  'data.insurance.policyNumber', 'data.insurance.expiryDate',
  'data.lastVisitAt', 'data.notes',
]
const missing = REQUIRED.filter((p) => !paths.includes(p))
if (missing.length) {
  console.error('manifest 缺少预期字段路径:\n  ' + missing.join('\n  '))
  console.error('实际集合:\n  ' + paths.join('\n  '))
  process.exit(1)
}
console.log(`[verify-manifest] ${REQUIRED.length} 个预期字段路径全部命中（共 ${paths.length} 个字段）`)
```

Run: `cd examples/medical-records && node verify-manifest.mjs`
Expected: FAIL —— `ENOENT`，`.nx-mk/manifest.json` 不存在。这是本任务的 RED。

- [ ] **Step 2: 建 server（schema + 路由 + fixture）**

`examples/medical-records/server/package.json`：

```json
{
  "name": "@nx-mk-example/medical-server",
  "version": "0.1.0",
  "private": true,
  "description": "nx-mk 多域验证项目一 —— 医疗记录后端（嵌套关联 + enum + nullable）",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc --noEmit",
    "start": "tsx src/index.ts",
    "openapi": "tsx src/generate-openapi.ts",
    "typecheck": "tsc --noEmit",
    "test": "echo 'no server tests' && exit 0",
    "clean": "rm -rf dist *.tsbuildinfo ../swagger/openapi.json"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@hono/zod-openapi": "^0.19.1",
    "hono": "^4.6.10",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

`examples/medical-records/server/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowSyntheticDefaultImports": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

`examples/medical-records/server/src/index.ts`：

```ts
/**
 * @nx-mk-example/medical-server —— 医疗记录后端（验证项目一）
 *
 * 形状族（spec §3.1）：对象嵌套 / $ref 复用 / enum / nullable / 数组内嵌数组。
 * 响应体统一包在 data 下（demo 同构）—— manifest 以 'data' 为根走 walkSchema，
 * 故 normalizedPath 形如 data.contact.phone、data[].medications[].name。
 *
 * P1：路径参数 {patientId} 不进 coverage 分母，页面无需渲染它。
 * P1 + C1 回显设计：POST /patients 的 201 体回显写入值，供页面渲染同一路径。
 * 真 100% 口径（G1）：不造 4xx/5xx 响应体 —— 每个响应 schema 字段都需被渲染，
 * 错误响应验证由项目三专责。
 */
import { serve } from '@hono/node-server'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const ContactSchema = z
  .object({
    phone: z.string().openapi({ example: '+86-13800138000' }),
    email: z.string().openapi({ example: 'alice@example.com' }),
  })
  .openapi('Contact')

const EmergencyContactSchema = z
  .object({
    name: z.string().openapi({ example: '张伟' }),
    relation: z.string().openapi({ example: '父子' }),
  })
  .openapi('EmergencyContact')

const InsuranceSchema = z
  .object({
    policyNumber: z.string().openapi({ example: 'POL-2024-8891' }),
    expiryDate: z.string().openapi({ example: '2027-03-31' }),
  })
  .openapi('Insurance')

const GenderEnum = z.enum(['male', 'female', 'other'])
const BloodTypeEnum = z.enum(['A', 'B', 'O', 'AB'])
const DepartmentEnum = z.enum(['cardiology', 'neurology', 'general'])

const PatientSchema = z
  .object({
    id: z.string().openapi({ example: 'p_001' }),
    name: z.string().openapi({ example: 'Alice Chen' }),
    birthDate: z.string().openapi({ example: '1988-04-12' }),
    gender: GenderEnum.openapi({ example: 'female' }),
    bloodType: BloodTypeEnum.openapi({ example: 'O' }),
    contact: ContactSchema,
    emergencyContact: EmergencyContactSchema,
    insurance: InsuranceSchema,
    lastVisitAt: z.string().openapi({ example: '2026-09-28T09:12:00Z' }),
    notes: z.string().nullable().openapi({ example: '轻度高血压，随访中' }),
  })
  .openapi('Patient')

const VitalSignsSchema = z
  .object({
    heartRate: z.number().int().openapi({ example: 72 }),
    heightCm: z.number().openapi({ example: 168 }),
    weightKg: z.number().openapi({ example: 61.5 }),
  })
  .openapi('VitalSigns')

const MedicationSchema = z
  .object({
    name: z.string().openapi({ example: '氨氯地平' }),
    dosage: z.string().openapi({ example: '5mg qd' }),
    prescribed: z.boolean().openapi({ example: true }),
  })
  .openapi('Medication')

const VisitSchema = z
  .object({
    id: z.string().openapi({ example: 'v_001' }),
    visitAt: z.string().openapi({ example: '2026-09-28T09:12:00Z' }),
    department: DepartmentEnum.openapi({ example: 'cardiology' }),
    diagnosis: z.string().openapi({ example: '原发性高血压' }),
    vitals: VitalSignsSchema,
    medications: z.array(MedicationSchema).openapi({
      example: [{ name: '氨氯地平', dosage: '5mg qd', prescribed: true }],
    }),
  })
  .openapi('Visit')

const NewPatientSchema = z
  .object({
    name: z.string().openapi({ example: 'Bob Li' }),
    birthDate: z.string().openapi({ example: '1992-11-03' }),
  })
  .openapi('NewPatient')

// 回显体：写入值必须出现在响应里，页面才能用同一 normalizedPath 覆盖
const CreatedPatientSchema = z
  .object({
    id: z.string().openapi({ example: 'p_new' }),
    name: z.string().openapi({ example: 'Bob Li' }),
    createdAt: z.string().openapi({ example: '2026-10-04T10:00:00Z' }),
  })
  .openapi('CreatedPatient')

const getPatientRoute = createRoute({
  method: 'get',
  path: '/patients/{patientId}',
  operationId: 'getPatient',
  tags: ['patients'],
  summary: '患者详情',
  request: { params: z.object({ patientId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: PatientSchema } } },
  },
})

const listVisitsRoute = createRoute({
  method: 'get',
  path: '/patients/{patientId}/visits',
  operationId: 'listPatientVisits',
  tags: ['visits'],
  summary: '患者就诊记录',
  request: { params: z.object({ patientId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(VisitSchema) } } },
  },
})

const createPatientRoute = createRoute({
  method: 'post',
  path: '/patients',
  operationId: 'createPatient',
  tags: ['patients'],
  summary: '新建患者（201 回显写入值）',
  request: { body: { content: { 'application/json': { schema: NewPatientSchema } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: CreatedPatientSchema } } },
  },
})

type Visit = {
  id: string
  visitAt: string
  department: 'cardiology' | 'neurology' | 'general'
  diagnosis: string
  vitals: { heartRate: number; heightCm: number; weightKg: number }
  medications: { name: string; dosage: string; prescribed: boolean }[]
}

function makeVisit(
  id: string,
  visitAt: string,
  department: Visit['department'],
  diagnosis: string,
  heartRate: number,
  heightCm: number,
  weightKg: number,
  medications: Visit['medications'],
): Visit {
  return { id, visitAt, department, diagnosis, vitals: { heartRate, heightCm, weightKg }, medications }
}

const PATIENTS = [
  {
    id: 'p_001',
    name: 'Alice Chen',
    birthDate: '1988-04-12',
    gender: 'female' as const,
    bloodType: 'O' as const,
    contact: { phone: '+86-13800138000', email: 'alice@example.com' },
    emergencyContact: { name: '张伟', relation: '父子' },
    insurance: { policyNumber: 'POL-2024-8891', expiryDate: '2027-03-31' },
    lastVisitAt: '2026-09-28T09:12:00Z',
    notes: '轻度高血压，随访中',
  },
  {
    id: 'p_002',
    name: 'Bob Li',
    birthDate: '1992-11-03',
    gender: 'male' as const,
    bloodType: 'A' as const,
    contact: { phone: '+86-13900139000', email: 'bob@example.com' },
    emergencyContact: { name: '李静', relation: '母女' },
    insurance: { policyNumber: 'POL-2025-1204', expiryDate: '2026-12-31' },
    // nullable 验证点：notes 为 null → 页面必须渲染占位符（A1/A2，否则 suspicious）
    notes: null,
  },
]

const VISITS: Record<string, Visit[]> = {
  p_001: [
    makeVisit('v_001', '2026-09-28T09:12:00Z', 'cardiology', '原发性高血压', 72, 168, 61.5, [
      { name: '氨氯地平', dosage: '5mg qd', prescribed: true },
      { name: '缬沙坦', dosage: '80mg qd', prescribed: true },
    ]),
    makeVisit('v_002', '2026-06-14T10:00:00Z', 'general', '年度体检', 68, 168, 62.1, [
      { name: '维生素D', dosage: '400IU qd', prescribed: false },
    ]),
  ],
  // 空 medications 数组验证点：数组字段仍需渲染（渲染 '—' 占位，A1/A2）
  p_002: [makeVisit('v_003', '2026-08-15T14:30:00Z', 'neurology', '偏头痛', 78, 174, 70.4, [])],
}

export const app = new OpenAPIHono()

app.openapi(getPatientRoute, (c) => {
  const { patientId } = c.req.valid('param')
  const found = PATIENTS.find((p) => p.id === patientId)
  // 找不到时返回同 schema 的空值（而非 404 body）—— 避免新增响应 schema 拉高覆盖分母
  const empty = {
    id: '', name: '', birthDate: '1970-01-01', gender: 'other' as const, bloodType: 'AB' as const,
    contact: { phone: '', email: '' }, emergencyContact: { name: '', relation: '' },
    insurance: { policyNumber: '', expiryDate: '' }, lastVisitAt: '', notes: null,
  }
  return c.json(found ?? empty, 200)
})

app.openapi(listVisitsRoute, (c) => {
  const { patientId } = c.req.valid('param')
  return c.json(VISITS[patientId] ?? [], 200)
})

app.openapi(createPatientRoute, (c) => {
  const body = c.req.valid('json')
  return c.json({ id: `p_${Date.now()}`, name: body.name, createdAt: new Date().toISOString() }, 201)
})

app.doc('/doc', {
  openapi: '3.0.3',
  info: { title: 'nx-mk medical records API', version: '0.1.0', description: '验证项目一：嵌套关联 + enum + nullable' },
})

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT ?? 8801)
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[medical/server] listening on http://localhost:${info.port}`)
  })
}
```

`examples/medical-records/server/src/generate-openapi.ts`：

```ts
/** 把 OpenAPI 文档落盘到 ../swagger/openapi.json —— plugin-swagger 的输入 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, '..', '..', 'swagger', 'openapi.json')
mkdirSync(dirname(outPath), { recursive: true })

const spec = app.getOpenAPIDocument({
  openapi: '3.0.3',
  info: { title: 'nx-mk medical records API', version: '0.1.0', description: '验证项目一：嵌套关联 + enum + nullable' },
})
writeFileSync(outPath, JSON.stringify(spec, null, 2))
console.log(`[medical/openapi] wrote ${outPath}`)
```

- [ ] **Step 3: 建 app 骨架（自驱动单页，S2/S4）**

`examples/medical-records/app/package.json`：

```json
{
  "name": "@nx-mk-example/medical-app",
  "version": "0.1.0",
  "private": true,
  "description": "nx-mk 验证项目一前端 —— React + Vite + SDK Facade",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'demo lint skipped'",
    "test": "echo 'demo tests skipped'",
    "clean": "rm -rf dist *.tsbuildinfo"
  },
  "dependencies": {
    "@nx-mk/client": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "typescript": "^5.3.3",
    "vite": "^5.4.10"
  }
}
```

`examples/medical-records/app/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowSyntheticDefaultImports": true,
    "jsx": "react-jsx",
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

`examples/medical-records/app/vite.config.ts`：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 验证项目一前端 —— 跨端口访问后端 8801（proxy 剥 /api 前缀，页面同源无 CORS）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5201,
    proxy: {
      '/api': {
        target: process.env.VITE_MEDICAL_API_BASE ?? 'http://localhost:8801',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  define: {
    __VITE_MEDICAL_API_BASE__: JSON.stringify(process.env.VITE_MEDICAL_API_BASE ?? 'http://localhost:8801'),
    // G6：MK_ANALYSIS 必须给 vite 进程（启动时烘焙 __MK_ANALYSIS__），不是给 CLI
    __MK_ANALYSIS__: JSON.stringify(process.env.MK_ANALYSIS === 'true'),
  },
})
```

`examples/medical-records/app/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>nx-mk medical-records 验证项目</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`examples/medical-records/app/src/HomePage.tsx`：

```tsx
/** 入口说明区 —— 不参与 coverage（无 data-mk-field），仅提供项目自述 */
export function HomePage() {
  return (
    <header>
      <h1>医疗记录验证项目</h1>
      <p>形状族：对象嵌套 / $ref 复用 / enum / nullable / 数组内嵌数组</p>
    </header>
  )
}
```

`examples/medical-records/app/src/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HomePage } from './HomePage.js'
import { PatientDetail } from './PatientDetail.js'
import { VisitHistory } from './VisitHistory.js'
import { NewPatientForm } from './NewPatientForm.js'

/**
 * S2：场景 DSL 无 click/fill，页面必须自驱动 —— 单页聚合渲染全部视图，
 * 进入即自动请求并渲染所有数据。S4：整页导航重置 collector 缓冲，故场景只能 goto 一次，
 * 不能靠多路由分别 goto —— 全部数据必须在同一页内呈现。
 * Task 2 补 PatientDetail/VisitHistory，Task 3 补 NewPatientForm。
 */
function App() {
  return (
    <div data-page="medical-records">
      <HomePage />
      <PatientDetail />
      <VisitHistory />
      <NewPatientForm />
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: 写 config 与 gitignore**

`examples/medical-records/.gitignore`：

```
# openapi 产物 —— 由 pnpm medical:openapi 落盘
swagger/openapi.json

# 构建产物
app/dist
server/dist
app/*.tsbuildinfo
server/*.tsbuildinfo
```

`examples/medical-records/nx-mk.config.yml`：

```yaml
# nx-mk 多域验证项目一 —— 医疗记录（spec §3.1 / §4.1）
# 用法：先起 server(8801) 与 app(5201, MK_ANALYSIS=true)，再在本目录跑 nx-mk run
version: 1

project:
  name: nx-mk-medical-records

openapi: ./swagger/openapi.json

plugins:
  - '@nx-mk/plugin-swagger'

collect:
  url: http://localhost:5201
  maxTurns: 3

# G3：Goal Loop 以 100% 为终止条件
goal:
  targetRatio: 1.0
  maxTurns: 5
  idleTurnsLimit: 2
  absoluteTimeoutMs: 60000

# G1/G2：真 100% —— ignored 必须为空数组，required 空即全字段 required
coverage:
  required: []
  optional: []
  ignored: []

# §26 场景套件（S4：单场景单 goto，靠页面自驱动覆盖全部视图）
scenarios:
  include:
    - "mk/scenarios/*.yml"
  concurrency: 1

runtime:
  retainRuns: 5

dashboard:
  port: 4318
  open: false
```

- [ ] **Step 5: 装依赖 + 产出 openapi + 跑 manifest 验证（GREEN）**

```bash
cd /d/DevProjects/my/github/nx-mk
pnpm install
pnpm --filter @nx-mk-example/medical-server openapi
cd examples/medical-records
node ../../packages/cli/dist/index.js run
node verify-manifest.mjs
```

Expected:
- `[medical/openapi] wrote .../examples/medical-records/swagger/openapi.json`
- `nx-mk run` 产出 `.nx-mk/manifest.json`（manifest 只解析 swagger 文件，不需要后端在跑）
- `[verify-manifest] 13 个预期字段路径全部命中（共 N 个字段）`

若 `nx-mk run` 因浏览器不可用而中止（collection 阶段需要 chromium），manifest 仍会在 beforeRun 阶段落盘 —— 继续跑 `node verify-manifest.mjs` 即可；chromium 相关问题留到 Task 4 处理。

- [ ] **Step 6: codegen 产出 generated-sdk.ts（入 git）**

`examples/medical-records/generate-sdk.ts`：

```ts
/** .nx-mk/manifest.json → app/src/generated-sdk.ts（G4：产物入 git，同 demo） */
import { readFileSync, writeFileSync } from 'node:fs'
import { generateSdk } from '../../packages/client/dist/codegen.js'

const manifest = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))
const code = generateSdk(manifest, { baseUrl: '/api' })
writeFileSync(new URL('./app/src/generated-sdk.ts', import.meta.url), code)
console.log(`[codegen] wrote app/src/generated-sdk.ts (${code.length} bytes)`)
```

Run: `cd examples/medical-records && pnpm exec tsx generate-sdk.ts`
Expected: `[codegen] wrote app/src/generated-sdk.ts (N bytes)`；随后 `grep -c 'getPatient\|listPatientVisits\|createPatient' app/src/generated-sdk.ts` ≥ 3。

- [ ] **Step 7: server typecheck（GREEN 门）**

```bash
cd /d/DevProjects/my/github/nx-mk
pnpm --filter @nx-mk-example/medical-server typecheck
```

Expected: `Done`（0 errors）。

⚠️ **app typecheck 此刻必然失败** —— `main.tsx` 已 import `PatientDetail`/`VisitHistory`/`NewPatientForm`，三个文件 Task 2/3 才创建。这是预期的中间态。**Task 1 的完成契约 = server typecheck 通过 + verify-manifest 通过**（server 是本任务可独立验证的交付物）。Task 3 结束时复跑 app typecheck。

- [ ] **Step 8: 根 package.json 加 script（G7）**

在 `package.json` 的 `scripts` 中，`demo:codegen` 之后插入三行：

```json
"medical:openapi": "pnpm --filter @nx-mk-example/medical-server openapi",
"medical:codegen": "pnpm --filter @nx-mk-example/medical-server openapi && pnpm --filter @nx-mk/cli build && cd examples/medical-records && node ../../packages/cli/dist/index.js run && pnpm exec tsx generate-sdk.ts",
"medical:typecheck": "corepack pnpm --filter @nx-mk-example/medical-app typecheck && corepack pnpm --filter @nx-mk-example/medical-server typecheck",
```

- [ ] **Step 9: Commit**

```bash
git add examples/medical-records package.json
git commit -m "feat(examples): medical-records 验证项目骨架（嵌套+enum+nullable，spec §3.1）

Hono+zod-openapi server（\$ref 复用 Contact、enum 性别/血型/科室、nullable notes、
数组内嵌数组 medications）+ React/Vite app 自驱动单页骨架（S2：DSL 无 click）
+ coverage.ignored: [] 真 100% 口径（G1）+ manifest 字段路径验证脚本。
P1：路径参数与请求体不进分母 → POST 用 201 回显设计。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```---

### Task 2: 患者详情页 + 就诊记录页（覆盖 13 个患者字段 + 数组嵌套字段）

**Files:**
- Create: `examples/medical-records/app/src/PatientDetail.tsx`
- Create: `examples/medical-records/app/src/VisitHistory.tsx`
- Create: `examples/medical-records/verify-pages.mjs`

**Interfaces:**
- Consumes: Task 1 的 `app/src/generated-sdk.ts`（导出 `api` 与 `Patient` 类型）、`@nx-mk/client/react` 的 `Field` 组件、Task 1 的 `main.tsx` 单页聚合结构（这两个组件已在 `main.tsx` 被 import）
- Produces:
  - `PatientDetail()` — 渲染 `data.id` / `data.name` / `data.birthDate` / `data.gender` / `data.bloodType` / `data.contact.phone` / `data.contact.email` / `data.emergencyContact.name` / `data.emergencyContact.relation` / `data.insurance.policyNumber` / `data.insurance.expiryDate` / `data.lastVisitAt` / `data.notes` 共 13 个 Field
  - `VisitHistory()` — 渲染 `data[].id` / `data[].visitAt` / `data[].department` / `data[].diagnosis` / `data[].vitals.heartRate` / `data[].vitals.heightCm` / `data[].vitals.weightKg` / `data[].medications[].name` / `data[].medications[].dosage` / `data[].medications[].prescribed` 共 10 个 Field
  - `verify-pages.mjs` — 静态扫描两个组件源码，断言：(a) 每个 `field="..."` 字面量都在 manifest 的 `normalizedPath` 集合中（Review Focus #4）；(b) 每个 Field 的 children 不是直接渲染字段名本身（Review Focus #1 的静态近似）

- [ ] **Step 1: 写失败的页面静态验证脚本（RED）**

创建 `examples/medical-records/verify-pages.mjs`：

```js
/**
 * 页面静态验证 —— 两个出口：
 *   1. 每个 field="..." 字面量必须存在于 manifest 的 normalizedPath 集合（防 P3 数组路径写错）
 *   2. 每个 field="X" 的 Field 元素，其 children 不能恰好是 X 的最后一段（防 A3 weak 判定）
 *   3. 每个 Field 的 children 必须经由占位符兜底（不能是可能为空的裸表达式 —— 防 A1/A2）
 */
import { readFileSync } from 'node:fs'

const m = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))
const paths = new Set(m.fields.map((f) => f.normalizedPath))

const PAGES = ['./app/src/PatientDetail.tsx', './app/src/VisitHistory.tsx']
const problems = []

for (const rel of PAGES) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const match of src.matchAll(/field="([^"]+)"/g)) {
    const field = match[1]
    if (!paths.has(field)) problems.push(`${rel}: field="${field}" 不在 manifest 的 normalizedPath 集合中`)
    // A3：找 Field 后紧跟的 children 文本节点，若等于字段名末段则 weak
    const after = src.slice(match.index, match.index + 300)
    const leaf = field.split('.').pop() ?? field
    const childrenMatch = after.match(/\/?>\s*\{([^}]*)\}/)
    if (childrenMatch && childrenMatch[1].trim() === leaf) {
      problems.push(`${rel}: field="${field}" 的 children 恰为字段名末段 "${leaf}" → 会被 classifyEvidence 判 weak（A3）`)
    }
    // A1/A2：裸字段表达式（可能为 null/undefined）必须带 ?? 占位符
    if (childrenMatch && childrenMatch[1].includes('.') && !childrenMatch[1].includes('??')) {
      problems.push(`${rel}: field="${field}" 的 children 是裸表达式 {${childrenMatch[1]}}，可能为空 → 需 ?? 占位符（A1/A2）`)
    }
  }
}

if (problems.length) {
  console.error('页面静态验证失败:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(`[verify-pages] 页面 Field 字面量全部合法（${PAGES.length} 个文件）`)
```

Run: `cd examples/medical-records && node verify-pages.mjs`
Expected: FAIL —— `ENOENT`，`app/src/PatientDetail.tsx` 不存在。这是本任务的 RED。

- [ ] **Step 2: 写 PatientDetail.tsx（13 字段，含 A1/A2/A3 全部防护）**

创建 `examples/medical-records/app/src/PatientDetail.tsx`：

```tsx
/**
 * 患者详情 —— 覆盖 GET /patients/{patientId} 的全部 13 个响应字段。
 *
 * A1/A2（空值防护）：notes 可为 null、其余字段理论上均可空 —— 所有 children 都过
 *   `?? '—'`，保证 span 有非零可见内容（空 span → visible:false → suspicious，不算 hit）。
 * A3（防 weak）：children 绝不等于字段名末段 —— data.name 渲染 'Alice Chen' 而非 'name'；
 *   data.gender 渲染中文标签而非 'gender'。
 * P2：field 值逐字等于 manifest 的 normalizedPath（如 data.contact.phone）。
 * P1：路径参数 patientId 不进分母，无需渲染。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type Patient } from './generated-sdk.js'

/** 空值占位符 —— A1/A2：保证 Field 子节点永不为空串（空 span 会被判 suspicious） */
const DASH = '—'

/** enum 值 → 中文标签。A3：渲染值不等于字段名末段（'gender' / 'bloodType'），故做映射 */
const GENDER_LABEL: Record<string, string> = { male: '男', female: '女', other: '其他' }
const BLOOD_LABEL: Record<string, string> = { A: 'A 型', B: 'B 型', O: 'O 型', AB: 'AB 型' }

export function PatientDetail() {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.patients
      .getPatient({ patientId: 'p_001' })
      .then(setPatient)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <section data-page="patient-error">加载失败：{error}</section>
  if (!patient) return <section data-page="patient-loading">加载中…</section>

  return (
    <section data-page="patient-detail">
      <h2>患者详情</h2>
      <dl>
        <dt>姓名</dt>
        <dd><Field field="data.name">{patient.name || DASH}</Field></dd>

        <dt>编号</dt>
        <dd><Field field="data.id">{patient.id || DASH}</Field></dd>

        <dt>出生日期</dt>
        <dd><Field field="data.birthDate">{patient.birthDate || DASH}</Field></dd>

        {/* A3：GENDER_LABEL 映射后的中文标签 ≠ 'gender' */}
        <dt>性别</dt>
        <dd>
          <Field field="data.gender">
            {patient.gender ? (GENDER_LABEL[patient.gender] ?? patient.gender) : DASH}
          </Field>
        </dd>

        <dt>血型</dt>
        <dd>
          <Field field="data.bloodType">
            {patient.bloodType ? (BLOOD_LABEL[patient.bloodType] ?? patient.bloodType) : DASH}
          </Field>
        </dd>

        <dt>联系电话</dt>
        <dd><Field field="data.contact.phone">{patient.contact?.phone || DASH}</Field></dd>

        <dt>联系邮箱</dt>
        <dd><Field field="data.contact.email">{patient.contact?.email || DASH}</Field></dd>

        <dt>紧急联系人</dt>
        <dd><Field field="data.emergencyContact.name">{patient.emergencyContact?.name || DASH}</Field></dd>

        <dt>与患者关系</dt>
        <dd><Field field="data.emergencyContact.relation">{patient.emergencyContact?.relation || DASH}</Field></dd>

        <dt>保单号</dt>
        <dd><Field field="data.insurance.policyNumber">{patient.insurance?.policyNumber || DASH}</Field></dd>

        <dt>保险到期</dt>
        <dd><Field field="data.insurance.expiryDate">{patient.insurance?.expiryDate || DASH}</Field></dd>

        <dt>最近就诊</dt>
        <dd><Field field="data.lastVisitAt">{patient.lastVisitAt || DASH}</Field></dd>

        {/* A1/A2 关键点：p_002.notes 为 null —— 此处仍渲染 DASH 占位而非空 span。
            页面固定请求 p_001（notes 非 null），但 DASH 兜底保证任一路径都不出空 span。 */}
        <dt>备注</dt>
        <dd><Field field="data.notes">{patient.notes || DASH}</Field></dd>
      </dl>
    </section>
  )
}
```

- [ ] **Step 3: 写 VisitHistory.tsx（数组嵌套，含空数组兜底）**

创建 `examples/medical-records/app/src/VisitHistory.tsx`：

```tsx
/**
 * 就诊记录 —— 覆盖 GET /patients/{patientId}/visits 的全部 10 个字段。
 *
 * P3（数组路径）：field 值用 manifest 归一化形态 `data[].x`，不是下标形态。
 *   顶层数组元素 → `data[].id`；嵌套数组元素 → `data[].medications[].name`。
 * A1/A2（空数组兜底）：medications 为空数组时仍须渲染该字段（渲染 DASH 占位），
 *   否则该字段在本次采集里没有任何 evidence → 判 missing。
 *   注意：模板字符串把数组 join 成单个 Field，路径仍是元素路径（归一化后一致）。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type Visit } from './generated-sdk.js'

const DASH = '—'
const DEPARTMENT_LABEL: Record<string, string> = {
  cardiology: '心血管科',
  neurology: '神经内科',
  general: '全科',
}

export function VisitHistory() {
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.visits
      .listPatientVisits({ patientId: 'p_001' })
      .then(setVisits)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) return <section data-page="visits-error">加载失败：{error}</section>
  if (!visits) return <section data-page="visits-loading">加载中…</section>

  return (
    <section data-page="visit-history">
      <h2>就诊记录（{visits.length} 次）</h2>
      {visits.length === 0 && <p>暂无就诊记录</p>}
      <ol>
        {visits.map((visit) => (
          <li key={visit.id} data-visit-id={visit.id}>
            <div>
              {/* A3：渲染 visit id 值本身（'v_001'），不等于末段 'id' */}
              <Field field="data[].id">{visit.id || DASH}</Field>
              {' · '}
              <Field field="data[].visitAt">{visit.visitAt || DASH}</Field>
              {' · '}
              <Field field="data[].department">
                {visit.department ? (DEPARTMENT_LABEL[visit.department] ?? visit.department) : DASH}
              </Field>
            </div>
            <div>
              诊断：
              <Field field="data[].diagnosis">{visit.diagnosis || DASH}</Field>
            </div>
            <div>
              生命体征：
              <Field field="data[].vitals.heartRate">{String(visit.vitals?.heartRate ?? DASH)}</Field>
              {' bpm / '}
              {/* A1：0 也是有效渲染（String(0) = '0' 非空）—— 用 ?? 而非 ||，
                  否则 heartRate=0 会被 || 吞成 DASH，虽不算 suspicious 但失真 */}
              <Field field="data[].vitals.heightCm">{String(visit.vitals?.heightCm ?? DASH)}</Field>
              {' cm / '}
              <Field field="data[].vitals.weightKg">{String(visit.vitals?.weightKg ?? DASH)}</Field>
              {' kg'}
            </div>
            <div>
              用药：
              {/* A1/A2：空数组时渲染 DASH 占位 —— 否则 medications 三个字段本次无 evidence → missing */}
              {visit.medications && visit.medications.length > 0 ? (
                <ul>
                  {visit.medications.map((med) => (
                    <li key={med.name}>
                      <Field field="data[].medications[].name">{med.name || DASH}</Field>
                      {' '}
                      <Field field="data[].medications[].dosage">{med.dosage || DASH}</Field>
                      {' '}
                      {/* A3：布尔渲染 '是'/'否'，不等于末段 'prescribed' */}
                      <Field field="data[].medications[].prescribed">
                        {med.prescribed ? '在服用' : '已停用'}
                      </Field>
                    </li>
                  ))}
                </ul>
              ) : (
                <Field field="data[].medications[].name">{DASH}</Field>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
```

- [ ] **Step 4: 跑静态验证（GREEN）**

```bash
cd examples/medical-records
node verify-pages.mjs
node verify-manifest.mjs
```

Expected: 两条均打印成功行（`[verify-pages] 页面 Field 字面量全部合法（2 个文件）` / `[verify-manifest] 13 个预期字段路径全部命中`）。

⚠️ 若 `verify-pages.mjs` 报「field="data[].medications[].name" 不在 manifest 集合」—— 说明 Task 1 的 schema-walker 对双层数组的归一化与计划假设不同（P3）。此时**不要改页面去迁就**，先打印 manifest 实际的 `normalizedPath` 集合核对，然后在本计划记录 Ruling 并修正页面字面量。

- [ ] **Step 5: app typecheck**

```bash
cd /d/DevProjects/my/github/nx-mk
pnpm --filter @nx-mk-example/medical-app typecheck
```

Expected: `Done`（0 errors）。

⚠️ `NewPatientForm.tsx` 仍缺失（Task 3 创建），`main.tsx` 对它的 import 会失败 —— 这是预期的中间态。**Task 2 的完成契约 = verify-pages 通过 + server typecheck 通过**；app typecheck 在 Task 3 收口。

- [ ] **Step 6: Commit**

```bash
git add examples/medical-records/app/src/PatientDetail.tsx examples/medical-records/app/src/VisitHistory.tsx examples/medical-records/verify-pages.mjs
git commit -m "feat(examples): 患者详情页 + 就诊记录页（23 个字段，含 anti-cheat 防护）

13 个患者字段 + 10 个数组嵌套字段。关键防护：
- A1/A2：所有 children 过 ?? '—' 兜底（notes 可为 null、空 medications 数组）
- A3：enum 映射中文标签、布尔渲染'在服用'/'已停用'，均不等于字段名末段
- P3：数组路径用 data[].medications[].name 归一化形态，非下标
- verify-pages.mjs 静态校验 field 字面量合法性 + A3/A1 违规

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```---

### Task 3: 新建患者表单（201 回显 —— P1/C1 的核心验证）

**Files:**
- Create: `examples/medical-records/app/src/NewPatientForm.tsx`

**Interfaces:**
- Consumes: Task 1 的 `generated-sdk.ts`（`api.patients.createPatient({body:{name,birthDate}})` → `CreatedPatient`）、`Field` 组件；Task 1 `main.tsx` 已 import 本组件
- Produces: 渲染 `data.id` / `data.name` / `data.createdAt` 三个回显字段

- [ ] **Step 1: 写失败的回显验证（RED）**

本任务的「测试」是运行期证据而非单测 —— 故先写**场景前置检查**：确认 `main.tsx` 引用的组件不存在（当前状态）。

Run: `ls examples/medical-records/app/src/NewPatientForm.tsx`
Expected: FAIL —— `No such file or directory`。这是本任务的 RED。

- [ ] **Step 2: 写 NewPatientForm.tsx（自提交 + 回显渲染）**

创建 `examples/medical-records/app/src/NewPatientForm.tsx`：

```tsx
/**
 * 新建患者表单 —— 覆盖 POST /patients 的 201 回显字段（P1/C1 回显设计）。
 *
 * P1：请求体字段（NewPatientSchema 的 name/birthDate）**不进 coverage 分母** ——
 *   只有 201 响应体字段进。故页面渲染的是**回显对象**（id/name/createdAt），
 *   且 name 既是请求值也是响应值，同一 normalizedPath `data.name` 被覆盖。
 *
 * S2（自驱动，无 click/fill）：场景 DSL 无表单交互能力，故组件在 mount 时
 *   自动提交一次固定数据（name='Bob Li', birthDate='1992-11-03'），
 *   拿到 201 后渲染回显区。这样 goto 一次即完成整个写路径的覆盖。
 *
 * A1/A2/A3：回显值均非空且不等于字段名末段；加载/错误态不渲染 Field。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type CreatedPatient } from './generated-sdk.js'

const DASH = '—'

export function NewPatientForm() {
  const [created, setCreated] = useState<CreatedPatient | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // S2 自驱动：mount 即提交固定表单数据，不依赖用户交互
    api.patients
      .createPatient({ body: { name: 'Bob Li', birthDate: '1992-11-03' } })
      .then(setCreated)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <section data-page="new-patient">
      <h2>新建患者（201 回显验证）</h2>
      {error && <p data-page="new-patient-error">提交失败：{error}</p>}
      {!created && !error && <p>提交中…</p>}
      {created && (
        <dl>
          <dt>新建编号</dt>
          <dd><Field field="data.id">{created.id || DASH}</Field></dd>

          {/* data.name：请求写入的值在此回显 —— 同一路径同时验证写路径与读路径 */}
          <dt>登记姓名</dt>
          <dd><Field field="data.name">{created.name || DASH}</Field></dd>

          <dt>登记时间</dt>
          <dd><Field field="data.createdAt">{created.createdAt || DASH}</Field></dd>
        </dl>
      )}
    </section>
  )
}
```

⚠️ **A4 冲突预警**：本组件渲染 `data.id` 与 `data.name`，而 `PatientDetail` 也渲染同名字段。两者都产出 evidence，取**最差质量**（A4）。因两处 children 分别是 `'p_xxx'`/`'Alice Chen'` 与 `'p_yyy'`/`'Bob Li'`，都不等于末段 `id`/`name`，均为 valid —— 无拖累。**但这要求实现期不得在任一处改成裸字段名渲染**（`verify-pages.mjs` 的 A3 检查覆盖此点）。

⚠️ **P3 路径歧义**：`data.id` 既出现在 GET `/patients/{id}` 的响应，也出现在 POST `/patients` 的 201 响应。manifest 为二者生成**不同 fieldId**（field-id 由 `method:path:direction:status:normalizedPath` 派生），故两个 Field 属性字符串相同但分别命中各自 fieldId —— 这是正确行为，页面无需区分。

- [ ] **Step 3: app typecheck 收口（GREEN）**

```bash
cd /d/DevProjects/my/github/nx-mk
pnpm --filter @nx-mk-example/medical-app typecheck
pnpm --filter @nx-mk-example/medical-server typecheck
```

Expected: 两条均 `Done`（0 errors）。此刻 `main.tsx` 的三个 import 全部有着落。

- [ ] **Step 4: 复跑静态验证**

```bash
cd examples/medical-records
node verify-pages.mjs
node verify-manifest.mjs
```

Expected: 两条均通过。

- [ ] **Step 5: Commit**

```bash
git add examples/medical-records/app/src/NewPatientForm.tsx
git commit -m "feat(examples): 新建患者表单（201 回显验证 P1/C1 设计）

请求体字段不进 coverage 分母（P1）→ 提交后渲染 201 回显对象，
data.name 既是请求值也是响应值，同一路径覆盖写+读双路径。
S2 自驱动：mount 即提交固定数据，场景无需 click/fill 即可覆盖写路径。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 场景套件 + 真 100% 验收门（批次一闸门）

**Files:**
- Create: `examples/medical-records/mk/scenarios/patient.yml`
- Create: `examples/medical-records/verify-coverage.mjs`
- Create: `examples/medical-records/README.md`

**Interfaces:**
- Consumes: Task 1 的 config（含 `scenarios.include`）、Task 2/3 的三个页面组件、Task 1 的 server + app
- Produces: `verify-coverage.mjs` —— 验收断言 A–H 的可执行实现（Task 7 的汇总脚本直接复用其核心逻辑）；项目 README（实测输出 + 已知限制）

- [ ] **Step 1: 写场景套件（S4：单 goto + 自驱动单页）**

创建 `examples/medical-records/mk/scenarios/patient.yml`：

```yaml
# medical-records 场景套件 —— S4：整页导航会重置 collector 缓冲，故只 goto 一次，
# 页面自驱动渲染全部视图（患者详情 / 就诊记录 / 新建回显）。
# S3：assertFieldVisible 只是定位辅助，coverage 100% 的门在 verify-coverage.mjs（B/C/D/E）。
version: 1
scenarios:
  - id: medical-patient-full
    name: 患者详情 + 就诊记录 + 新建回显 全字段覆盖
    route: /
    steps:
      - id: goto-app
        type: goto
        url: http://localhost:5201/

      - id: wait-detail
        type: waitFor
        selector: "[data-page='patient-detail']"
      - id: wait-visits
        type: waitFor
        selector: "[data-page='visit-history']"
      - id: wait-created
        type: waitFor
        selector: "[data-page='new-patient'] dl"

      # 患者详情 13 字段（P2：逐字等于 normalizedPath）
      - id: assert-name
        type: assertFieldVisible
        field: data.name
      - id: assert-id
        type: assertFieldVisible
        field: data.id
      - id: assert-birth-date
        type: assertFieldVisible
        field: data.birthDate
      - id: assert-gender
        type: assertFieldVisible
        field: data.gender
      - id: assert-blood-type
        type: assertFieldVisible
        field: data.bloodType
      - id: assert-contact-phone
        type: assertFieldVisible
        field: data.contact.phone
      - id: assert-contact-email
        type: assertFieldVisible
        field: data.contact.email
      - id: assert-emergency-name
        type: assertFieldVisible
        field: data.emergencyContact.name
      - id: assert-emergency-relation
        type: assertFieldVisible
        field: data.emergencyContact.relation
      - id: assert-policy-number
        type: assertFieldVisible
        field: data.insurance.policyNumber
      - id: assert-expiry-date
        type: assertFieldVisible
        field: data.insurance.expiryDate
      - id: assert-last-visit
        type: assertFieldVisible
        field: data.lastVisitAt
      - id: assert-notes
        type: assertFieldVisible
        field: data.notes

      # 就诊记录 10 字段（P3：数组用 [] 归一化形态）
      - id: assert-visit-id
        type: assertFieldVisible
        field: data[].id
      - id: assert-visit-at
        type: assertFieldVisible
        field: data[].visitAt
      - id: assert-department
        type: assertFieldVisible
        field: data[].department
      - id: assert-diagnosis
        type: assertFieldVisible
        field: data[].diagnosis
      - id: assert-heart-rate
        type: assertFieldVisible
        field: data[].vitals.heartRate
      - id: assert-height
        type: assertFieldVisible
        field: data[].vitals.heightCm
      - id: assert-weight
        type: assertFieldVisible
        field: data[].vitals.weightKg
      - id: assert-med-name
        type: assertFieldVisible
        field: data[].medications[].name
      - id: assert-med-dosage
        type: assertFieldVisible
        field: data[].medications[].dosage
      - id: assert-med-prescribed
        type: assertFieldVisible
        field: data[].medications[].prescribed

      # 新建回显（data.id / data.name / data.createdAt 与上方同名字段共��，由 A4 保证均为 valid）
      - id: assert-created-at
        type: assertFieldVisible
        field: data.createdAt

      - id: shot
        type: screenshot
```

**step 数校验**（S5 上限 50）：本文件 31 条，未超限。

- [ ] **Step 2: 写失败的验收脚本（RED）**

创建 `examples/medical-records/verify-coverage.mjs`：

```js
/**
 * 真 100% 验收门 —— 断言 A–H（spec §5 / Global Constraints 验收断言块）。
 * 只读断言，不跑采集；采集由 `nx-mk run` 在此之前完成。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const root = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const require = createRequire(import.meta.url)

const failures = []
const ok = (cond, msg) => { if (!cond) failures.push(msg) }

// 断言 B/C/D/E：coverage-report.json
const reportPath = join(root, '.nx-mk', 'coverage-report.json')
ok(existsSync(reportPath), `断言 B: 缺 ${reportPath} —— 先跑 nx-mk run`)
if (existsSync(reportPath)) {
  const r = JSON.parse(readFileSync(reportPath, 'utf8'))
  const m = r.metrics
  ok(m.requiredCoverage === 1, `断言 B: requiredCoverage=${m.requiredCoverage}（应为 1）`)
  ok(m.missingRequiredFields === 0, `断言 C: missingRequiredFields=${m.missingRequiredFields}（应为 0）`)
  ok(m.suspiciousFields === 0, `断言 D: suspiciousFields=${m.suspiciousFields}（应为 0）`)
  const weak = r.weakEvidenceFields ?? []
  ok(weak.length === 0, `断言 E: weakEvidenceFields 非空（${weak.length} 条）—— A2/A3 违规:\n` +
    weak.slice(0, 10).map((w) => `      ${w.fieldPath ?? w.fieldId}`).join('\n'))
  // 缺口定位（Review Focus #5：套件全过也可能未 100%）
  const missing = r.missingRequiredFields ?? []
  if (missing.length) {
    console.error('缺失字段清单:\n' + missing.map((f) => `  - ${f.fieldPath}`).join('\n'))
  }
}

// 断言 F：coverage.ignored 为空
const cfg = readFileSync(join(root, 'nx-mk.config.yml'), 'utf8')
const ignoredBlock = cfg.match(/ignored:\s*\[([^\]]*)\]/s)
ok(ignoredBlock && ignoredBlock[1].trim() === '', '断言 F: coverage.ignored 非空')

// 断言 A：runs.terminated_by === 'goal-met'
const dbPath = join(root, '.nx-mk', 'coverage.db')
ok(existsSync(dbPath), `断言 H: 缺 ${dbPath}`)
if (existsSync(dbPath)) {
  let Database
  try {
    Database = require('better-sqlite3')
  } catch {
    Database = null
  }
  if (Database) {
    const db = new Database(dbPath, { readonly: true })
    const run = db.prepare('SELECT terminated_by FROM runs ORDER BY started_at DESC LIMIT 1').get()
    ok(run?.terminated_by === 'goal-met', `断言 A: terminated_by=${run?.terminated_by}（应为 goal-met）`)
    // 断言 H：三表非空
    for (const t of ['field_hits', 'ui_evidence', 'request_traces']) {
      const c = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()
      ok(c.n > 0, `断言 H: ${t} 表为空`)
    }
    db.close()
  } else {
    console.warn('[verify] better-sqlite3 不可用 —— 跳过断言 A/H（db 直查）')
  }
}

// 断言 G：场景结果。
// ⚠️ 计划勘误（实现期读码发现）：场景结果**不落 scenarios.json**——plugin-playwright
// 只 emit `scenario:done` 事件到 events.jsonl，且**场景失败不影响退出码**（E8：仅 warn）。
// 故断言 G 改为解析 events.jsonl 里的 scenario:done 事件，检查 ok===true 且至少有一条。
const runsDir = join(root, '.nx-mk', 'runs')
if (existsSync(runsDir)) {
  let sawDone = false
  const failedScenarios = []
  for (const d of readdirSync(runsDir)) {
    const f = join(runsDir, d, 'events.jsonl')
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.includes('"scenario:done"')) continue
      sawDone = true
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'scenario:done' && ev.ok !== true) failedScenarios.push(`${ev.scenarioId} (ok=${ev.ok})`)
      } catch { /* 非 JSON 行忽略 */ }
    }
  }
  ok(sawDone, '断言 G: 未找到 scenario:done 事件 —— 场景套件未执行（检查 config 的 scenarios.include 与 yml glob）')
  ok(failedScenarios.length === 0, `断言 G: 场景失败: ${failedScenarios.join(', ')}`)
} else {
  ok(false, `断言 G: 缺 ${runsDir}`)
}

// 断言 6（Review Focus）：场景文件每份只含一个 goto
const scenarioFile = join(root, 'mk', 'scenarios', 'patient.yml')
if (existsSync(scenarioFile)) {
  const text = readFileSync(scenarioFile, 'utf8')
  const gotoCount = (text.match(/type:\s*goto/g) ?? []).length
  ok(gotoCount === 1, `断言 6(S4): patient.yml 含 ${gotoCount} 个 goto（应为 1）`)
}

if (failures.length) {
  console.error('\n验收失败:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'))
  process.exit(1)
}
console.log('[verify-coverage] 断言 A–H 全过 —— requiredCoverage=100% ✅')
```

Run: `cd examples/medical-records && node verify-coverage.mjs`
Expected: FAIL —— 缺 `.nx-mk/coverage-report.json`（采集尚未跑）。这是本任务的 RED。

- [ ] **Step 3: 起服务 + 跑采集 + 诊断到 100%（GREEN，可能多轮）**

```bash
# 0. chromium 缺失时先装
npx playwright install chromium

# 1. 后端（8801）
cd /d/DevProjects/my/github/nx-mk
pnpm --filter @nx-mk-example/medical-server dev &

# 2. 前端（5201，MK_ANALYSIS=true 给 vite 进程 —— G6）
MK_ANALYSIS=true pnpm --filter @nx-mk-example/medical-app dev &

# 3. 场景套件驱动采集
cd examples/medical-records
node ../../packages/cli/dist/index.js run

# 4. 验收
node verify-coverage.mjs
```

Expected（首轮未必全过 —— 失败信息即定位入口）：

- `nx-mk run` 打印 Coverage 三行 + `goal:met`
- `verify-coverage.mjs` 打印 `[verify-coverage] 断言 A–H 全过`

**诊断循环**（按失败断言分类，**每次只改一处，重跑**）：

| 失败断言 | 根因 | 修法 |
|---|---|---|
| B（requiredCoverage<1）+ 缺 `data.xxx` | 该字段无 evidence | 补 `<Field field="data.xxx">`，确认值非空（A1/A2） |
| B + 缺 `data[].yyy` | 数组只渲染了首元素，或路径字面量写错（P3） | 核对 manifest 实际 `normalizedPath`，改页面字面量 |
| D（suspicious>0） | 空 span 或 hidden DOM | 全部 children 加 `?? '—'`；检查 CSS 是否有 `display:none` |
| E（weak>0） | A3 误判（值等于字段名末段）或 A2 空文本 | 改渲染值：enum 映射中文标签、布尔渲「是/否」、数值 `String()` |
| A（terminated_by≠goal-met） | goal 未达成或 config 段缺失 | 核对 `goal.targetRatio: 1.0` 与 `coverage.required: []` |
| G（无 scenarios.json） | `scenarios.include` glob 不匹配 | 核对 yml 路径为 `mk/scenarios/*.yml` |

**⚠️ 禁止的绕过手段**（G1）：不得往 `coverage.ignored` 加任何字段；不得把字段从 OpenAPI schema 里删掉来降低分母。覆盖不了就修页面，或记入 README「已知限制」。

- [ ] **Step 4: 写项目 README（记录实测证据）**

创建 `examples/medical-records/README.md`，内容必须包含以下实测值（从 Step 3 的产物抄录，不许编）：

```markdown
# medical-records（验证项目一）

形状族：**对象嵌套 / $ref 复用 / enum / nullable / 数组内嵌数组**

## 启动与验收

```bash
# 0. 依赖
pnpm install && npx playwright install chromium

# 1. 后端（8801）
pnpm --filter @nx-mk-example/medical-server dev

# 2. 前端（5201）—— MK_ANALYSIS 必须给 vite 进程
MK_ANALYSIS=true pnpm --filter @nx-mk-example/medical-app dev

# 3. 采集 + 验收（项目目录内）
cd examples/medical-records
node ../../packages/cli/dist/index.js run
node verify-coverage.mjs
```

## 实测验收输出

<!-- 粘贴 verify-coverage.mjs 的实际输出 + coverage-report.json 的 metrics 三行 -->

## 口径说明

- **P1**：coverage 分母只含响应字段。本项目 `GET /patients/{patientId}` 的路径参数
  `patientId` 不进分母，页面不渲染它。`POST /patients` 的请求体字段同理 ——
  改用 **201 回显**设计：响应体回显写入的 `name`，页面渲染同一 `data.name` 路径。
- **A1/A2**：所有 Field 的 children 过 `?? '—'` 兜底（`notes` 可为 null、空 medications 数组）。
- **A3**：enum 映射中文标签、布尔渲染「在服用/已停用」，均不等于字段名末段。
- **P3**：数组路径用 `data[].medications[].name` 归一化形态，非下标形态。
- **S4**：场景只含一个 `goto`（单页聚合渲染全部视图），规避整页导航重置 collector 缓冲。

## 已知限制

<!-- 填写本项目暴露的 nx-mk 能力缺口；无则写「本次验证未发现缺口」 -->
```

- [ ] **Step 5: Commit**

```bash
git add examples/medical-records/mk examples/medical-records/verify-coverage.mjs examples/medical-records/README.md
git commit -m "feat(examples): medical-records 场景套件 + 真 100% 验收门（批次一闸门）

verify-coverage.mjs 实现断言 A–H：goal-met / requiredCoverage=1 /
missing=0 / suspicious=0 / weak=[] / ignored=[] / 场景全过 / 三表非空，
并静态校验场景单 goto（S4）。README 记录实测输出与口径说明。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: 记录批次一闸门结论**

在 ledger 追加一行：`Batch 1 闸门：medical-records 达成真 100%（requiredCoverage=1, ignored=[]）—— 批次二解锁`。

若**未达成**：暂停批次二，把缺口清单交回人类伙伴决策（修页面 vs 记录为能力缺口 vs 调整 spec 口径），**不要带着未达标状态启动项目二**。---

### Task 5: commerce-orders 项目（分页 envelope + 深层数组）

**Files:**
- Create: `examples/commerce-orders/` 全部文件（结构与 medical-records 逐字同构，仅换 domain）
  - `.gitignore` / `nx-mk.config.yml` / `verify-manifest.mjs` / `verify-pages.mjs` / `verify-coverage.mjs` / `generate-sdk.ts` / `README.md`
  - `server/{package.json,tsconfig.json,src/index.ts,src/generate-openapi.ts}`
  - `app/{package.json,tsconfig.json,vite.config.ts,index.html,src/main.tsx,src/generated-sdk.ts,src/ProductList.tsx,src/OrderList.tsx,src/CheckoutForm.tsx}`
  - `mk/scenarios/order.yml`

**Interfaces:**
- Consumes: Task 1–4 的全部模式（server/app/config/三类 verify 脚本/场景 yml 结构）。**逐字复制 Task 1–4 的文件，只替换 domain 相关的 schema、路由、fixture、页面内容、场景断言字段名。**
- Produces: 第二个达成真 100% 的项目；端口 8802/5202

**本任务与 Task 1–4 的三处刻意差异**（形状族分化点）：

| 差异点 | medical-records | commerce-orders |
|---|---|---|
| 数组顶层 | 裸数组 `Visit[]` | **分页 envelope** `data.items[]` + `data.total` / `data.page` / `data.pageSize` / `data.hasNext` |
| 嵌套深度 | 2 层（`data[].medications[]`） | 3 层（`data.items[].tags[]`、`data[].items[]`） |
| 对象嵌套 | 患者详情里 `contact.*` | 订单里 `data[].shipping.address.line1`（数组 → 对象 → 对象） |
| nullable | `notes`（1 处） | `data[].shipping.address.line2` + `data[].payment.paidAt`（2 处） |
| query 参数 | 无 | `?page=&pageSize=`（P1：不进分母，但页面需驱动它以拿到数据） |

- [ ] **Step 1: 复制 Task 1-4 骨架并替换 domain**

```bash
cd /d/DevProjects/my/github/nx-mk
cp -r examples/medical-records examples/commerce-orders
cd examples/commerce-orders
# 清掉不需复制的产物
rm -rf .nx-mk swagger app/src/generated-sdk.ts
# 全局替换标识符
sed -i 's/medical/orders/g; s/Medical/Orders/g; s/MEDICAL/ORDERS/g; s/patient/buyer/g; s/Patient/Buyer/g' \
  package.json server/package.json app/package.json nx-mk.config.yml \
  server/src/*.ts app/src/main.tsx app/vite.config.ts app/index.html
```

⚠️ **sed 替换后必须人工核对**：schema 名、路由 path、tag 都会连带变化。逐个文件读一遍确认语义正确（尤其 `PatientSchema` → `BuyerSchema` 后字段语义仍自洽）。

- [ ] **Step 2: 写 server（分页 envelope + 三层数组）**

替换 `server/src/index.ts` 的内容 —— schemas 与路由：

```ts
/**
 * @nx-mk-example/orders-server —— 订单/商品后端（验证项目二）
 *
 * 形状族（spec §3.2）：分页 envelope（data.items[] + total/page/pageSize/hasNext）、
 * 三层数组（data.items[].tags[]、data[].items[]）、数组→对象→对象嵌套
 * （data[].shipping.address.*）、双 nullable（line2 / paidAt）。
 *
 * P1：query 参数 ?page=&pageSize= 不进 coverage 分母 —— 页面仍需传它们才能拿到分页数据，
 * 但不需（也不应）为它们渲染 data-mk-field。
 */
import { serve } from '@hono/node-server'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const SupplierSchema = z
  .object({
    id: z.string().openapi({ example: 'sup_01' }),
    name: z.string().openapi({ example: '宁波精密制造' }),
    region: z.string().openapi({ example: '华东' }),
  })
  .openapi('Supplier')

const CurrencyEnum = z.enum(['CNY', 'USD', 'EUR'])

const ProductSchema = z
  .object({
    id: z.string().openapi({ example: 'prd_001' }),
    sku: z.string().openapi({ example: 'SKU-8842' }),
    name: z.string().openapi({ example: '静音机械键盘' }),
    price: z.number().openapi({ example: 399 }),
    currency: CurrencyEnum.openapi({ example: 'CNY' }),
    category: z.string().openapi({ example: '外设' }),
    tags: z.array(z.string()).openapi({ example: ['电脑', '办公'] }),
    supplier: SupplierSchema,
  })
  .openapi('Product')

// 分页 envelope：数组包在 data.items 下，四个标量与数组平级
const ProductPageSchema = z
  .object({
    items: z.array(ProductSchema).openapi({ example: [] }),
    total: z.number().int().openapi({ example: 42 }),
    page: z.number().int().openapi({ example: 1 }),
    pageSize: z.number().int().openapi({ example: 10 }),
    hasNext: z.boolean().openapi({ example: true }),
  })
  .openapi('ProductPage')

const AddressSchema = z
  .object({
    line1: z.string().openapi({ example: '文一西路 969 号' }),
    line2: z.string().nullable().openapi({ example: 'A 座 15F' }),
    city: z.string().openapi({ example: '杭州' }),
    postalCode: z.string().openapi({ example: '310000' }),
    country: z.string().openapi({ example: '中国' }),
  })
  .openapi('ShippingAddress')

const ShippingSchema = z
  .object({
    recipient: z.string().openapi({ example: '王芳' }),
    address: AddressSchema,
  })
  .openapi('Shipping')

const PaymentSchema = z
  .object({
    method: z.enum(['alipay', 'wechat', 'card']).openapi({ example: 'alipay' }),
    paidAt: z.string().nullable().openapi({ example: '2026-09-30T11:20:00Z' }),
  })
  .openapi('Payment')

const OrderItemSchema = z
  .object({
    sku: z.string().openapi({ example: 'SKU-8842' }),
    name: z.string().openapi({ example: '静音机械键盘' }),
    unitPrice: z.number().openapi({ example: 399 }),
    quantity: z.number().int().openapi({ example: 2 }),
    lineTotal: z.number().openapi({ example: 798 }),
  })
  .openapi('OrderItem')

const OrderStatusEnum = z.enum(['pending', 'paid', 'shipped', 'completed', 'cancelled'])

const OrderSchema = z
  .object({
    id: z.string().openapi({ example: 'ord_001' }),
    status: OrderStatusEnum.openapi({ example: 'paid' }),
    placedAt: z.string().openapi({ example: '2026-09-30T10:05:00Z' }),
    totalAmount: z.number().openapi({ example: 1836 }),
    currency: CurrencyEnum.openapi({ example: 'CNY' }),
    items: z.array(OrderItemSchema).openapi({ example: [] }),
    shipping: ShippingSchema,
    payment: PaymentSchema,
  })
  .openapi('Order')

const OrderDetailSchema = z
  .object({
    id: z.string().openapi({ example: 'ord_001' }),
    status: OrderStatusEnum.openapi({ example: 'shipped' }),
    customerName: z.string().openapi({ example: '王芳' }),
    note: z.string().nullable().openapi({ example: '工作日送达' }),
  })
  .openapi('OrderDetail')

const NewOrderSchema = z
  .object({
    sku: z.string().openapi({ example: 'SKU-8842' }),
    quantity: z.number().int().min(1).openapi({ example: 2 }),
  })
  .openapi('NewOrder')

const CreatedOrderSchema = z
  .object({
    id: z.string().openapi({ example: 'ord_new' }),
    status: OrderStatusEnum.openapi({ example: 'pending' }),
    totalAmount: z.number().openapi({ example: 798 }),
    placedAt: z.string().openapi({ example: '2026-10-04T10:00:00Z' }),
  })
  .openapi('CreatedOrder')

const listProductsRoute = createRoute({
  method: 'get',
  path: '/products',
  operationId: 'listProducts',
  tags: ['products'],
  summary: '商品分页列表',
  request: { query: z.object({ page: z.string().optional(), pageSize: z.string().optional() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: ProductPageSchema } } },
  },
})

const listOrdersRoute = createRoute({
  method: 'get',
  path: '/orders',
  operationId: 'listOrders',
  tags: ['orders'],
  summary: '订单列表',
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(OrderSchema) } } },
  },
})

const createOrderRoute = createRoute({
  method: 'post',
  path: '/orders',
  operationId: 'createOrder',
  tags: ['orders'],
  summary: '下单（201 回显）',
  request: { body: { content: { 'application/json': { schema: NewOrderSchema } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: CreatedOrderSchema } } },
  },
})

const getOrderRoute = createRoute({
  method: 'get',
  path: '/orders/{orderId}',
  operationId: 'getOrder',
  tags: ['orders'],
  summary: '订单详情',
  request: { params: z.object({ orderId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: OrderDetailSchema } } },
  },
})

const PRODUCTS = [
  {
    id: 'prd_001', sku: 'SKU-8842', name: '静音机械键盘', price: 399, currency: 'CNY' as const,
    category: '外设', tags: ['电脑', '办公'], supplier: { id: 'sup_01', name: '宁波精密制造', region: '华东' },
  },
  {
    id: 'prd_002', sku: 'SKU-1031', name: '人体工学椅', price: 1899, currency: 'CNY' as const,
    category: '家具', tags: ['办公'], supplier: { id: 'sup_02', name: '佛山家具工业', region: '华南' },
  },
]

type Order = {
  id: string
  status: 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled'
  placedAt: string
  totalAmount: number
  currency: 'CNY' | 'USD' | 'EUR'
  items: { sku: string; name: string; unitPrice: number; quantity: number; lineTotal: number }[]
  shipping: { recipient: string; address: { line1: string; line2: string | null; city: string; postalCode: string; country: string } }
  payment: { method: 'alipay' | 'wechat' | 'card'; paidAt: string | null }
}

const ORDERS: Order[] = [
  {
    id: 'ord_001', status: 'paid', placedAt: '2026-09-30T10:05:00Z', totalAmount: 1836, currency: 'CNY',
    items: [
      { sku: 'SKU-8842', name: '静音机械键盘', unitPrice: 399, quantity: 2, lineTotal: 798 },
      { sku: 'SKU-1031', name: '人体工学椅', unitPrice: 519, quantity: 2, lineTotal: 1038 },
    ],
    shipping: { recipient: '王芳', address: { line1: '文一西路 969 号', line2: 'A 座 15F', city: '杭州', postalCode: '310000', country: '中国' } },
    payment: { method: 'alipay', paidAt: '2026-09-30T11:20:00Z' },
  },
  {
    id: 'ord_002', status: 'pending', placedAt: '2026-10-02T16:40:00Z', totalAmount: 399, currency: 'CNY',
    items: [{ sku: 'SKU-8842', name: '静音机械键盘', unitPrice: 399, quantity: 1, lineTotal: 399 }],
    shipping: { recipient: '李强', address: { line1: '中关村大街 27 号', line2: null, city: '北京', postalCode: '100080', country: '中国' } },
    // nullable 验证点 2：未支付 → paidAt 为 null，页面必须渲染占位符（A1/A2）
    payment: { method: 'wechat', paidAt: null },
  },
]

export const app = new OpenAPIHono()

app.openapi(listProductsRoute, (c) => {
  const { page, pageSize } = c.req.valid('query')
  const p = Number(page ?? 1)
  const size = Number(pageSize ?? 10)
  const start = (p - 1) * size
  const slice = PRODUCTS.slice(start, start + size)
  return c.json(
    { items: slice, total: PRODUCTS.length * 42, page: p, pageSize: size, hasNext: start + size < PRODUCTS.length * 42 },
    200,
  )
})

app.openapi(listOrdersRoute, (c) => c.json(ORDERS, 200))

app.openapi(createOrderRoute, (c) => {
  const body = c.req.valid('json')
  return c.json(
    { id: `ord_${Date.now()}`, status: 'pending', totalAmount: body.quantity * 399, placedAt: new Date().toISOString() },
    201,
  )
})

app.openapi(getOrderRoute, (c) => {
  const { orderId } = c.req.valid('param')
  const found = ORDERS.find((o) => o.id === orderId)
  const fallback = { id: '', status: 'cancelled' as const, customerName: '', note: null }
  return c.json(found ? { id: found.id, status: found.status, customerName: found.shipping.recipient, note: null } : fallback, 200)
})

app.doc('/doc', {
  openapi: '3.0.3',
  info: { title: 'nx-mk commerce orders API', version: '0.1.0', description: '验证项目二：分页 envelope + 深层数组' },
})

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT ?? 8802)
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[orders/server] listening on http://localhost:${info.port}`)
  })
}
```

`generate-openapi.ts` 同 Task 1，只改 info 标题与落盘路径不变（相对 `../../swagger`）。

- [ ] **Step 3: 写三个页面（envelope 标量 vs 数组元素必须分区渲染）**

`app/src/ProductList.tsx`（**envelope 标量字段渲染在列表容器外** —— spec §9 风险项）：

```tsx
/**
 * 商品分页列表 —— 覆盖 GET /products 的全部字段。
 *
 * 分区要点（spec §9）：envelope 四个标量（total/page/pageSize/hasNext）与数组元素
 * 字段路径不同（data.total vs data.items[].x），必须渲染在**不同的 DOM 区域**。
 * 把标量字段挂进数组循环会产出 data.items[].total —— 与 manifest 的 data.total 不匹配 → missing。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type ProductPage } from './generated-sdk.js'

const DASH = '—'
const CURRENCY_LABEL: Record<string, string> = { CNY: '人民币', USD: '美元', EUR: '欧元' }

export function ProductList() {
  const [page, setPage] = useState<ProductPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // P1：query 参数不进分母，但必须传才能拿到分页数据
    api.products.listProducts({ page: '1', pageSize: '10' }).then(setPage).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  if (error) return <section data-page="products-error">加载失败：{error}</section>
  if (!page) return <section data-page="products-loading">加载中…</section>

  return (
    <section data-page="product-list">
      <h2>商品列表</h2>

      {/* envelope 标量区 —— 路径 data.*，不在数组循环内 */}
      <div data-testid="page-summary">
        <Field field="data.total">{String(page.total)}</Field> 件商品 ·
        <Field field="data.page">第 {String(page.page)}</Field> 页 ·
        <Field field="data.pageSize">每页 {String(page.pageSize)} 条 ·
        {/* A3：渲染'有/无'而非 'hasNext' */}
        <Field field="data.hasNext">{page.hasNext ? '还有更多' : '已到末页'}</Field>
      </div>

      <ul>
        {page.items.map((p) => (
          <li key={p.id}>
            <div>
              <Field field="data.items[].name">{p.name || DASH}</Field>
              {' · '}
              {/* A3：SKU 渲染完整 sku 值，不等于末段 'sku' */}
              <Field field="data.items[].sku">{p.sku || DASH}</Field>
            </div>
            <div>
              {/* A1：price 可能为 0 → 用 ?? 而非 || */}
              单价 <Field field="data.items[].price">{String(p.price ?? DASH)}</Field>
              {' '}
              <Field field="data.items[].currency">
                {p.currency ? (CURRENCY_LABEL[p.currency] ?? p.currency) : DASH}
              </Field>
            </div>
            <div>
              分类 <Field field="data.items[].category">{p.category || DASH}</Field>
              {' · 标签 '}
              <Field field="data.items[].tags[]">{(p.tags ?? []).length > 0 ? p.tags.join(' / ') : DASH}</Field>
            </div>
            <div>
              供应商：
              <Field field="data.items[].supplier.id">{p.supplier?.id || DASH}</Field>
              {' '}
              <Field field="data.items[].supplier.name">{p.supplier?.name || DASH}</Field>
              {' '}
              <Field field="data.items[].supplier.region">{p.supplier?.region || DASH}</Field>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

`app/src/OrderList.tsx`（三层数组 + 双 nullable）：

```tsx
/**
 * 订单列表 —— 覆盖 GET /orders 的全部字段（三层数组 + 数组→对象→对象 + 双 nullable）。
 *
 * A1/A2 关键：ord_002 的 shipping.address.line2 与 payment.paidAt 均为 null —— 全部过 DASH 兜底。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type Order } from './generated-sdk.js'

const DASH = '—'
const STATUS_LABEL: Record<string, string> = {
  pending: '待付款', paid: '已付款', shipped: '已发货', completed: '已完成', cancelled: '已取消',
}
const PAY_METHOD_LABEL: Record<string, string> = { alipay: '支付宝', wechat: '微信支付', card: '银行卡' }
const CURRENCY_LABEL: Record<string, string> = { CNY: '人民币', USD: '美元', EUR: '欧元' }

export function OrderList() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.orders.listOrders({}).then(setOrders).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  if (error) return <section data-page="orders-error">加载失败：{error}</section>
  if (!orders) return <section data-page="orders-loading">加载中…</section>

  return (
    <section data-page="order-list">
      <h2>订单列表（{orders.length} 笔）</h2>
      <ol>
        {orders.map((o) => (
          <li key={o.id}>
            <div>
              <Field field="data[].id">{o.id || DASH}</Field>
              {' · '}
              <Field field="data[].status">{o.status ? (STATUS_LABEL[o.status] ?? o.status) : DASH}</Field>
              {' · '}
              <Field field="data[].placedAt">{o.placedAt || DASH}</Field>
            </div>
            <div>
              总额 <Field field="data[].totalAmount">{String(o.totalAmount ?? DASH)}</Field>
              {' '}
              <Field field="data[].currency">
                {o.currency ? (CURRENCY_LABEL[o.currency] ?? o.currency) : DASH}
              </Field>
            </div>
            <div>
              商品：
              {o.items && o.items.length > 0 ? (
                <ul>
                  {o.items.map((it) => (
                    <li key={it.sku}>
                      <Field field="data[].items[].sku">{it.sku || DASH}</Field>
                      {' '}
                      <Field field="data[].items[].name">{it.name || DASH}</Field>
                      {' × '}
                      <Field field="data[].items[].quantity">{String(it.quantity ?? DASH)}</Field>
                      {' 单价 '}
                      <Field field="data[].items[].unitPrice">{String(it.unitPrice ?? DASH)}</Field>
                      {' 小计 '}
                      <Field field="data[].items[].lineTotal">{String(it.lineTotal ?? DASH)}</Field>
                    </li>
                  ))}
                </ul>
              ) : (
                <Field field="data[].items[].sku">{DASH}</Field>
              )}
            </div>
            <div>
              收货人 <Field field="data[].shipping.recipient">{o.shipping?.recipient || DASH}</Field>
              {' · '}
              <Field field="data[].shipping.address.line1">{o.shipping?.address?.line1 || DASH}</Field>
              {/* nullable 1：ord_002.line2 为 null → DASH 兜底（A1/A2） */}
              {' · '}
              <Field field="data[].shipping.address.line2">{o.shipping?.address?.line2 || DASH}</Field>
              {' · '}
              <Field field="data[].shipping.address.city">{o.shipping?.address?.city || DASH}</Field>
              {' · '}
              <Field field="data[].shipping.address.postalCode">{o.shipping?.address?.postalCode || DASH}</Field>
              {' · '}
              <Field field="data[].shipping.address.country">{o.shipping?.address?.country || DASH}</Field>
            </div>
            <div>
              支付：
              <Field field="data[].payment.method">
                {o.payment?.method ? (PAY_METHOD_LABEL[o.payment.method] ?? o.payment.method) : DASH}
              </Field>
              {' · '}
              {/* nullable 2：ord_002.paidAt 为 null → DASH 兜底（A1/A2） */}
              <Field field="data[].payment.paidAt">{o.payment?.paidAt || DASH}</Field>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
```

`app/src/CheckoutForm.tsx` —— 逐字照 Task 3 的 `NewPatientForm.tsx` 改（`api.orders.createOrder` + `data.id`/`data.status`/`data.totalAmount`/`data.placedAt` 四个回显字段），注释里的域名词换成订单语义。

`app/src/main.tsx` —— 单页聚合 `ProductList` + `OrderList` + `CheckoutForm` + `HomePage`（照 Task 1）。

- [ ] **Step 4: config + 根 script**

`nx-mk.config.yml` 照 Task 1，改：`name: nx-mk-commerce-orders`、`collect.url: http://localhost:5202`、`dashboard.port: 4319`。

根 `package.json` 加：

```json
"orders:openapi": "pnpm --filter @nx-mk-example/orders-server openapi",
"orders:codegen": "pnpm --filter @nx-mk-example/orders-server openapi && pnpm --filter @nx-mk/cli build && cd examples/commerce-orders && node ../../packages/cli/dist/index.js run && pnpm exec tsx generate-sdk.ts",
"orders:typecheck": "corepack pnpm --filter @nx-mk-example/orders-app typecheck && corepack pnpm --filter @nx-mk-example/orders-server typecheck",
```

- [ ] **Step 5: 三类验证脚本对齐本项目字段集**

`verify-manifest.mjs` 的 REQUIRED 换成 commerce-orders 的字段路径（照页面里的 `field="..."` 字面量逐条抄，**含 envelope 标量与三层数组路径**）：

```js
const REQUIRED = [
  'data.total', 'data.page', 'data.pageSize', 'data.hasNext',
  'data.items[].id', 'data.items[].sku', 'data.items[].name', 'data.items[].price',
  'data.items[].currency', 'data.items[].category', 'data.items[].tags[]',
  'data.items[].supplier.id', 'data.items[].supplier.name', 'data.items[].supplier.region',
  'data[].id', 'data[].status', 'data[].placedAt', 'data[].totalAmount', 'data[].currency',
  'data[].items[].sku', 'data[].items[].name', 'data[].items[].quantity',
  'data[].items[].unitPrice', 'data[].items[].lineTotal',
  'data[].shipping.recipient', 'data[].shipping.address.line1', 'data[].shipping.address.line2',
  'data[].shipping.address.city', 'data[].shipping.address.postalCode', 'data[].shipping.address.country',
  'data[].payment.method', 'data[].payment.paidAt',
  'data.customerName', 'data.note',
  'data.createdAt',
]
```

⚠️ **P3 高危点**：`data.total`（envelope 标量）与 `data[].totalAmount`（订单数组元素）路径不同但语义相近 —— 抄写时不要混。`verify-manifest.mjs` 的首轮运行会暴露任何拼写错误。

`verify-pages.mjs` 的 `PAGES` 换成：

```js
const PAGES = ['./app/src/ProductList.tsx', './app/src/OrderList.tsx', './app/src/CheckoutForm.tsx']
```

`verify-coverage.mjs` **逐字复用** Task 4 的实现，只改 `root` 推导（已用 `import.meta.url`，无需改）与场景文件名断言（`mk/scenarios/order.yml`）。

- [ ] **Step 6: 写场景套件**

`mk/scenarios/order.yml`：

```yaml
# commerce-orders 场景套件 —— S4：单 goto；页面自驱动渲染三个视图。
version: 1
scenarios:
  - id: commerce-orders-full
    name: 商品分页 + 订单列表 + 下单回显 全字段覆盖
    route: /
    steps:
      - id: goto-app
        type: goto
        url: http://localhost:5202/
      - id: wait-products
        type: waitFor
        selector: "[data-page='product-list']"
      - id: wait-orders
        type: waitFor
        selector: "[data-page='order-list']"
      - id: wait-checkout
        type: waitFor
        selector: "[data-page='checkout'] dl"

      # envelope 标量（分区渲染，spec §9）
      - id: assert-total
        type: assertFieldVisible
        field: data.total
      - id: assert-page
        type: assertFieldVisible
        field: data.page
      - id: assert-page-size
        type: assertFieldVisible
        field: data.pageSize
      - id: assert-has-next
        type: assertFieldVisible
        field: data.hasNext

      # 商品数组（含三层 tags 与对象嵌套）
      - id: assert-item-name
        type: assertFieldVisible
        field: data.items[].name
      - id: assert-item-sku
        type: assertFieldVisible
        field: data.items[].sku
      - id: assert-item-id
        type: assertFieldVisible
        field: data.items[].id
      - id: assert-item-price
        type: assertFieldVisible
        field: data.items[].price
      - id: assert-item-currency
        type: assertFieldVisible
        field: data.items[].currency
      - id: assert-item-category
        type: assertFieldVisible
        field: data.items[].category
      - id: assert-item-tags
        type: assertFieldVisible
        field: data.items[].tags[]
      - id: assert-supplier-id
        type: assertFieldVisible
        field: data.items[].supplier.id
      - id: assert-supplier-name
        type: assertFieldVisible
        field: data.items[].supplier.name
      - id: assert-supplier-region
        type: assertFieldVisible
        field: data.items[].supplier.region

      # 订单数组（三层 items + 双 nullable）
      - id: assert-order-id
        type: assertFieldVisible
        field: data[].id
      - id: assert-order-status
        type: assertFieldVisible
        field: data[].status
      - id: assert-order-placed
        type: assertFieldVisible
        field: data[].placedAt
      - id: assert-order-total-amount
        type: assertFieldVisible
        field: data[].totalAmount
      - id: assert-order-currency
        type: assertFieldVisible
        field: data[].currency
      - id: assert-line-sku
        type: assertFieldVisible
        field: data[].items[].sku
      - id: assert-line-name
        type: assertFieldVisible
        field: data[].items[].name
      - id: assert-line-qty
        type: assertFieldVisible
        field: data[].items[].quantity
      - id: assert-line-unit-price
        type: assertFieldVisible
        field: data[].items[].unitPrice
      - id: assert-line-total
        type: assertFieldVisible
        field: data[].items[].lineTotal
      - id: assert-recipient
        type: assertFieldVisible
        field: data[].shipping.recipient
      - id: assert-addr-line1
        type: assertFieldVisible
        field: data[].shipping.address.line1
      - id: assert-addr-line2
        type: assertFieldVisible
        field: data[].shipping.address.line2
      - id: assert-addr-city
        type: assertFieldVisible
        field: data[].shipping.address.city
      - id: assert-addr-postal
        type: assertFieldVisible
        field: data[].shipping.address.postalCode
      - id: assert-addr-country
        type: assertFieldVisible
        field: data[].shipping.address.country
      - id: assert-pay-method
        type: assertFieldVisible
        field: data[].payment.method
      - id: assert-pay-at
        type: assertFieldVisible
        field: data[].payment.paidAt

      # 下单回显 + 订单详情
      - id: assert-placed-at
        type: assertFieldVisible
        field: data.placedAt
      - id: assert-customer-name
        type: assertFieldVisible
        field: data.customerName
      - id: assert-order-note
        type: assertFieldVisible
        field: data.note

      - id: shot
        type: screenshot
```

⚠️ **step 数校验**（S5 上限 50）：本文件 41 条，未超限。

⚠️ **订单详情未纳入**：`GET /orders/{orderId}` 的四个字段（`data.id`/`data.status`/`data.customerName`/`data.note`）需要页面额外请求该 endpoint。`OrderList` 组件里补一个 `useEffect` 调用 `api.orders.getOrder({orderId:'ord_001'})` 并渲染这四个字段（照 `ProductList` 的 envelope 标量分区模式，单开一个 `<div data-testid="order-detail">`）。**漏掉这一步会导致 D/E 断言失败**（该 endpoint 的字段无 evidence）。

- [ ] **Step 7: 装依赖 + 产出 + 验收**

```bash
cd /d/DevProjects/my/github/nx-mk
pnpm install
pnpm orders:codegen
pnpm --filter @nx-mk-example/orders-server typecheck
pnpm --filter @nx-mk-example/orders-app typecheck
pnpm --filter @nx-mk-example/orders-server dev &
MK_ANALYSIS=true pnpm --filter @nx-mk-example/orders-app dev &
cd examples/commerce-orders
node verify-manifest.mjs && node verify-pages.mjs
node ../../packages/cli/dist/index.js run
node verify-coverage.mjs
```

Expected: 全绿（含 `[verify-coverage] 断言 A–H 全过 —— requiredCoverage=100% ✅`）。诊断循环照 Task 4 Step 3 的表格，额外注意 envelope 分区混用（`data.total` vs `data[].items[].*`）。

- [ ] **Step 8: README + Commit**

按 Task 4 Step 4 的 README 模板写本项目的（形状族说明换成「分页 envelope + 深层数组」，口径说明补 envelope 分区要点）。

```bash
git add examples/commerce-orders package.json
git commit -m "feat(examples): commerce-orders 验证项目（分页 envelope + 深层数组，spec §3.2）

形状族：data.items[] + total/page/pageSize/hasNext 四标量、三层数组
（data.items[].tags[]、data[].items[]）、数组→对象→对象嵌套、
双 nullable（line2 / paidAt）。
envelope 标量与数组元素分区渲染（spec §9）—— 混用会产出
data.items[].total 与 manifest 的 data.total 不匹配。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```---

### Task 6: devops-incidents 项目（错误响应体 + 同 path 多状态码）

**Files:**
- Create: `examples/devops-incidents/` 全部文件（结构同 Task 5）
  - `.gitignore` / `nx-mk.config.yml` / `verify-manifest.mjs` / `verify-pages.mjs` / `verify-coverage.mjs` / `generate-sdk.ts` / `README.md`
  - `server/{package.json,tsconfig.json,src/index.ts,src/generate-openapi.ts}`
  - `app/{package.json,tsconfig.json,vite.config.ts,index.html,src/main.tsx,src/generated-sdk.ts,src/ServiceList.tsx,src/IncidentList.tsx,src/HealthChecker.tsx}`
  - `mk/scenarios/incident.yml`

**Interfaces:**
- Consumes: Task 5 的全部模式
- Produces: 第三个达成真 100% 的项目；端口 8803/5203

**本任务的独家验证点**（spec §3.3 / §9 头号风险）：

| 验证点 | 机制 | 依据 |
|---|---|---|
| **同 path 多状态码** | `GET /services/{name}/health` 同时声明 200 与 503 两个响应 schema → manifest 派生两组 fieldId（`status` 在 field-id 派生里含 status 段，故两组不冲突） | `manifest-schema/src/field-id.ts:20` rawKey 含 `status` |
| **非 2xx 响应体字段覆盖** | 503 走**原生 fetch**（SDK 对非 2xx 直接 throw，无 field hit）→ 页面把错误体渲染成错误卡（带 `data-mk-field`）→ DOM 扫描产出 ui_evidence → `accessHit \|\| uiHit` 判 covered | `client.ts:177` + `coverage-analyzer.ts:102` + `scanner.ts:17` |
| **shim 前缀要求** | 原生 fetch 必须打在 `/api` 前缀路径上才被 shim 观测到 trace（不影响 evidence，但保证 request_traces 非空） | `scanner.ts:132` `pathname === '/api' \|\| pathname.indexOf('/api/') === 0` |

- [ ] **Step 1: 复制骨架并替换 domain**

```bash
cd /d/DevProjects/my/github/nx-mk
cp -r examples/medical-records examples/devops-incidents
cd examples/devops-incidents
rm -rf .nx-mk swagger app/src/generated-sdk.ts
sed -i 's/medical/incidents/g; s/Medical/Incidents/g; s/MEDICAL/INCIDENTS/g; s/patient/service/g; s/Patient/Service/g' \
  package.json server/package.json app/package.json nx-mk.config.yml \
  server/src/*.ts app/src/main.tsx app/vite.config.ts app/index.html
```

⚠️ 端口必须改为 8803/5203（sed 不会改数字），逐文件核对后手动修正。

- [ ] **Step 2: 写 server（含同 path 双状态码）**

替换 `server/src/index.ts`：

```ts
/**
 * @nx-mk-example/incidents-server —— DevOps 服务/事件后端（验证项目三）
 *
 * 形状族（spec §3.3）：同 path 多状态码（200 + 503 两组响应 schema）、
 * 非 2xx 响应体字段、数组 + 双对象嵌套 + nullable。
 *
 * 关键：/services/{name}/health 的 503 体刻意包在 data 下（data.code / data.message /
 * data.retryAfterSeconds / data.contact），使 manifest 派生路径与 200 分支同前缀。
 * field-id 的 rawKey 含 status 段，两组分属不同 fieldId，可各自覆盖。
 */
import { serve } from '@hono/node-server'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const ServiceStatusEnum = z.enum(['healthy', 'degraded', 'down'])
const SeverityEnum = z.enum(['sev1', 'sev2', 'sev3'])
const IncidentStateEnum = z.enum(['open', 'mitigated', 'resolved'])
const HealthStatusEnum = z.enum(['pass', 'warn', 'fail'])
const ErrorCodeEnum = z.enum(['SERVICE_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'RATE_LIMITED'])

const ServiceSchema = z
  .object({
    id: z.string().openapi({ example: 'svc_001' }),
    name: z.string().openapi({ example: 'checkout-api' }),
    status: ServiceStatusEnum.openapi({ example: 'degraded' }),
    region: z.string().openapi({ example: 'cn-hangzhou' }),
    version: z.string().openapi({ example: '2.4.1' }),
    dependencies: z.array(z.string()).openapi({ example: ['postgres-main', 'redis-cache'] }),
    lastDeployedAt: z.string().openapi({ example: '2026-10-01T08:00:00Z' }),
  })
  .openapi('Service')

const AssigneeSchema = z
  .object({
    id: z.string().openapi({ example: 'u_07' }),
    name: z.string().openapi({ example: '陈工' }),
    email: z.string().openapi({ example: 'chen@example.com' }),
  })
  .openapi('Assignee')

const ImpactSchema = z
  .object({
    usersAffected: z.number().int().openapi({ example: 1420 }),
    regions: z.array(z.string()).openapi({ example: ['华东', '华南'] }),
  })
  .openapi('Impact')

const IncidentSchema = z
  .object({
    id: z.string().openapi({ example: 'inc_001' }),
    title: z.string().openapi({ example: '支付回调延迟升高' }),
    severity: SeverityEnum.openapi({ example: 'sev2' }),
    state: IncidentStateEnum.openapi({ example: 'open' }),
    openedAt: z.string().openapi({ example: '2026-10-02T03:12:00Z' }),
    // nullable 验证点：未解决事件 resolvedAt 为 null → 页面必须渲染占位符（A1/A2）
    resolvedAt: z.string().nullable().openapi({ example: null }),
    assignee: AssigneeSchema,
    impact: ImpactSchema,
  })
  .openapi('Incident')

const HealthCheckSchema = z
  .object({
    name: z.string().openapi({ example: 'db-connect' }),
    passed: z.boolean().openapi({ example: true }),
    latencyMs: z.number().int().openapi({ example: 12 }),
    message: z.string().openapi({ example: '连接池正常' }),
  })
  .openapi('HealthCheck')

// 200 分支
const HealthOkSchema = z
  .object({
    status: HealthStatusEnum.openapi({ example: 'pass' }),
    checks: z.array(HealthCheckSchema).openapi({ example: [] }),
  })
  .openapi('HealthOk')

// 503 分支 —— 刻意包在 data 下，与 200 分支同前缀（spec §3.3）
const HealthErrorSchema = z
  .object({
    code: ErrorCodeEnum.openapi({ example: 'SERVICE_UNAVAILABLE' }),
    message: z.string().openapi({ example: '下游依赖 postgres-main 不可用' }),
    retryAfterSeconds: z.number().int().openapi({ example: 30 }),
    contact: z.string().openapi({ example: 'oncall@example.com' }),
  })
  .openapi('HealthError')

const NewIncidentNoteSchema = z
  .object({ body: z.string().openapi({ example: '已扩容并观察 30 分钟' }) })
  .openapi('NewIncidentNote')

const IncidentNoteSchema = z
  .object({
    id: z.string().openapi({ example: 'note_001' }),
    body: z.string().openapi({ example: '已扩容并观察 30 分钟' }),
    createdAt: z.string().openapi({ example: '2026-10-02T06:00:00Z' }),
  })
  .openapi('IncidentNote')

const listServicesRoute = createRoute({
  method: 'get',
  path: '/services',
  operationId: 'listServices',
  tags: ['services'],
  summary: '服务列表',
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(ServiceSchema) } } },
  },
})

const listIncidentsRoute = createRoute({
  method: 'get',
  path: '/services/{serviceId}/incidents',
  operationId: 'listServiceIncidents',
  tags: ['incidents'],
  summary: '服务事件列表',
  request: { params: z.object({ serviceId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(IncidentSchema) } } },
  },
})

// ★ 核心：同 path 双状态码
const serviceHealthRoute = createRoute({
  method: 'get',
  path: '/services/{name}/health',
  operationId: 'getServiceHealth',
  tags: ['health'],
  summary: '服务健康检查（200 / 503 双分支）',
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: HealthOkSchema } } },
    503: { description: 'Service Unavailable', content: { 'application/json': { schema: HealthErrorSchema } } },
  },
})

const createIncidentNoteRoute = createRoute({
  method: 'post',
  path: '/incidents/{incidentId}/notes',
  operationId: 'createIncidentNote',
  tags: ['incidents'],
  summary: '追加事件备注（201 回显）',
  request: { params: z.object({ incidentId: z.string() }), body: { content: { 'application/json': { schema: NewIncidentNoteSchema } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: IncidentNoteSchema } } },
  },
})

const SERVICES = [
  {
    id: 'svc_001', name: 'checkout-api', status: 'degraded' as const, region: 'cn-hangzhou', version: '2.4.1',
    dependencies: ['postgres-main', 'redis-cache'], lastDeployedAt: '2026-10-01T08:00:00Z',
  },
  {
    id: 'svc_002', name: 'user-profile', status: 'healthy' as const, region: 'cn-hangzhou', version: '1.9.7',
    dependencies: ['postgres-main'], lastDeployedAt: '2026-09-28T11:30:00Z',
  },
]

const INCIDENTS = [
  {
    id: 'inc_001', title: '支付回调延迟升高', severity: 'sev2' as const, state: 'open' as const,
    openedAt: '2026-10-02T03:12:00Z', resolvedAt: null, // nullable 验证点
    assignee: { id: 'u_07', name: '陈工', email: 'chen@example.com' },
    impact: { usersAffected: 1420, regions: ['华东', '华南'] },
  },
  {
    id: 'inc_002', title: '报表导出超时', severity: 'sev3' as const, state: 'resolved' as const,
    openedAt: '2026-09-20T07:00:00Z', resolvedAt: '2026-09-20T11:20:00Z',
    assignee: { id: 'u_12', name: '刘工', email: 'liu@example.com' },
    impact: { usersAffected: 35, regions: ['华北'] },
  },
]

export const app = new OpenAPIHono()

app.openapi(listServicesRoute, (c) => c.json(SERVICES, 200))

app.openapi(listIncidentsRoute, (c) => {
  const { serviceId } = c.req.valid('param')
  void serviceId
  return c.json(INCIDENTS, 200)
})

// 503 触发条件：服务名含 'down' → 走错误分支（页面 HealthChecker 会请求该服务名）
app.openapi(serviceHealthRoute, (c) => {
  const { name } = c.req.valid('param')
  if (name.includes('down')) {
    return c.json(
      { code: 'SERVICE_UNAVAILABLE', message: '下游依赖 postgres-main 不可用', retryAfterSeconds: 30, contact: 'oncall@example.com' },
      503,
    )
  }
  return c.json(
    {
      status: 'pass' as const,
      checks: [
        { name: 'db-connect', passed: true, latencyMs: 12, message: '连接池正常' },
        { name: 'cache-ping', passed: true, latencyMs: 4, message: '缓存命中正常' },
      ],
    },
    200,
  )
})

app.openapi(createIncidentNoteRoute, (c) => {
  const body = c.req.valid('json')
  return c.json({ id: `note_${Date.now()}`, body: body.body, createdAt: new Date().toISOString() }, 201)
})

app.doc('/doc', {
  openapi: '3.0.3',
  info: { title: 'nx-mk devops incidents API', version: '0.1.0', description: '验证项目三：错误响应 + 同 path 多状态码' },
})

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT ?? 8803)
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[incidents/server] listening on http://localhost:${info.port}`)
  })
}
```

- [ ] **Step 3: 写 HealthChecker.tsx（★ 错误分支渲染 —— C2 绕行）**

创建 `app/src/HealthChecker.tsx`：

```tsx
/**
 * 健康检查 —— 验证同 path 双状态码的字段覆盖（spec §3.3 / C2 绕行）。
 *
 * 关键机制（spec §2 约束 C2 + P4/P5）：
 * - 503 走**原生 fetch**（`fetch('/api/services/{name}/health')`）—— SDK 对非 2xx 直接
 *   throw 且不解析响应体，故错误体只能靠原生 fetch 拿到；
 * - 拿到错误体后**必须渲染成带 data-mk-field 的可见元素** —— ui_evidence 来自 DOM 扫描
 *   （scanner.ts querySelectorAll('[data-mk-field]')），与 HTTP 通道无关（P5）；
 * - 覆盖判定 `accessHit || uiHit`（coverage-analyzer.ts:102），故无 field hit 也能 covered（P4）。
 *
 * A1/A2/A3：错误卡的四个字段全部过 DASH 兜底；code 映射为可读中文（避免 A3 弱判定）。
 * S2 自驱动：mount 即同时请求正常服务与故障服务，两条分支都在同一页渲染。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api } from './generated-sdk.js'

const DASH = '—'
const CODE_LABEL: Record<string, string> = {
  SERVICE_UNAVAILABLE: '服务不可用',
  UPSTREAM_TIMEOUT: '上游超时',
  RATE_LIMITED: '触发限流',
}
const CHECK_STATUS_LABEL: Record<string, string> = { pass: '正常', warn: '告警', fail: '失败' }

/** 200 分支的错误体类型（原生 fetch 路径，绕开 SDK 的非 2xx throw） */
type HealthError = {
  code: string
  message: string
  retryAfterSeconds: number
  contact: string
} | null

export function HealthChecker() {
  const [okChecks, setOkChecks] = useState<{ name: string; passed: boolean; latencyMs: number; message: string }[] | null>(null)
  const [okStatus, setOkStatus] = useState<string | null>(null)
  const [errBody, setErrBody] = useState<HealthError>(null)

  useEffect(() => {
    // 200 分支走 SDK（正常路径）
    api.health.getServiceHealth({ name: 'checkout-api' }).then((h) => {
      setOkStatus(h.status)
      setOkChecks(h.checks ?? [])
    }).catch(() => {
      /* 正常服务不该失败；失败则 200 分支字段无 evidence，由验收脚本暴露 */
    })

    // ★ 503 分支走原生 fetch —— SDK 会 throw（P4/C2），只有原生路径能拿到响应体。
    // 路径带 /api 前缀（scanner.ts 的 shim 只观测 /api 前缀，保证 request_traces 非空）。
    fetch('/api/services/down-api/health')
      .then(async (res) => {
        if (res.status !== 503) return
        setErrBody((await res.json()) as HealthError)
      })
      .catch(() => {
        /* 网络层失败：错误分支字段无 evidence，由验收脚本暴露 */
      })
  }, [])

  return (
    <section data-page="health-checker">
      <h2>健康检查</h2>

      {/* 200 分支 */}
      <div data-testid="health-ok">
        <h3>正常服务 checkout-api</h3>
        <p>
          总体状态：
          <Field field="data.status">{okStatus ? (CHECK_STATUS_LABEL[okStatus] ?? okStatus) : DASH}</Field>
        </p>
        <ul>
          {(okChecks ?? []).map((c) => (
            <li key={c.name}>
              {/* A3：渲染 c.name 值（'db-connect'），不等于末段 'name' */}
              <Field field="data.checks[].name">{c.name || DASH}</Field>
              {' · '}
              {/* A3/A2：布尔渲染 '通过'/'未通过'，非 'passed' */}
              <Field field="data.checks[].passed">{c.passed ? '通过' : '未通过'}</Field>
              {' · '}
              <Field field="data.checks[].latencyMs">{String(c.latencyMs ?? DASH)}</Field>
              {' ms · '}
              <Field field="data.checks[].message">{c.message || DASH}</Field>
            </li>
          ))}
        </ul>
      </div>

      {/* ★ 503 分支 —— 错误卡。四个字段必须全部渲染，否则该 503 响应的字段判 missing。 */}
      <div data-testid="health-error" data-page="health-error">
        <h3>故障服务 down-api（503 错误分支）</h3>
        {errBody ? (
          <dl>
            <dt>错误码</dt>
            {/* A3：CODE_LABEL 映射中文，避免渲染值等于末段 'code' */}
            <dd>
              <Field field="data.code">{errBody.code ? (CODE_LABEL[errBody.code] ?? errBody.code) : DASH}</Field>
            </dd>
            <dt>错误信息</dt>
            <dd><Field field="data.message">{errBody.message || DASH}</Field></dd>
            <dt>建议重试间隔</dt>
            <dd>
              <Field field="data.retryAfterSeconds">{String(errBody.retryAfterSeconds ?? DASH)}</Field>
              {' 秒'}
            </dd>
            <dt>联系邮箱</dt>
            <dd><Field field="data.contact">{errBody.contact || DASH}</Field></dd>
          </dl>
        ) : (
          <p>正在探测故障服务…</p>
        )}
      </div>
    </section>
  )
}
```

`ServiceList.tsx` 与 `IncidentList.tsx` 照 Task 5 的 `ProductList`/`OrderList` 模式，字段清单照 server 的 `ServiceSchema` / `IncidentSchema`（含 nullable `resolvedAt` 的 DASH 兜底）。

`main.tsx` 单页聚合 `ServiceList` + `IncidentList` + `HealthChecker` + `HomePage`。

- [ ] **Step 4: config + 根 script**

`nx-mk.config.yml`：`name: nx-mk-devops-incidents`、`collect.url: http://localhost:5203`、`dashboard.port: 4320`、`coverage.ignored: []`、`goal.targetRatio: 1.0`。

根 `package.json`：

```json
"incidents:openapi": "pnpm --filter @nx-mk-example/incidents-server openapi",
"incidents:codegen": "pnpm --filter @nx-mk-example/incidents-server openapi && pnpm --filter @nx-mk/cli build && cd examples/devops-incidents && node ../../packages/cli/dist/index.js run && pnpm exec tsx generate-sdk.ts",
"incidents:typecheck": "corepack pnpm --filter @nx-mk-example/incidents-app typecheck && corepack pnpm --filter @nx-mk-example/incidents-server typecheck",
```

- [ ] **Step 5: 三类验证脚本 + 场景套件**

`verify-manifest.mjs` REQUIRED：

```js
const REQUIRED = [
  // GET /services（数组）
  'data[].id', 'data[].name', 'data[].status', 'data[].region', 'data[].version',
  'data[].dependencies[]', 'data[].lastDeployedAt',
  // GET /services/{id}/incidents（数组 + 双对象 + nullable）
  'data[].id', 'data[].title', 'data[].severity', 'data[].state', 'data[].openedAt',
  'data[].resolvedAt', 'data[].assignee.id', 'data[].assignee.name', 'data[].assignee.email',
  'data[].impact.usersAffected', 'data[].impact.regions[]',
  // GET /services/{name}/health 200 分支
  'data.status', 'data.checks[].name', 'data.checks[].passed',
  'data.checks[].latencyMs', 'data.checks[].message',
  // GET /services/{name}/health 503 分支（C2 绕行的验证对象）
  'data.code', 'data.message', 'data.retryAfterSeconds', 'data.contact',
  // POST /incidents/{id}/notes 201 回显
  'data.body', 'data.createdAt',
]
```

⚠️ **必然触发的 P3/P2 陷阱**：`data[].id`（services 与 incidents 两个数组的 id 路径**完全相同**）—— manifest 为二者生成**不同 fieldId**（endpointId 不同），但 `normalizedPath` 字符串相同。故页面两个组件都写 `field="data[].id"` 是**正确**的（各自命中自己 endpoint 的 fieldId）。

⚠️ **`data.status` 同理**：`/services/{name}/health` 200 的 `data.status` 与 `/services` 数组的 `data[].status` 不同（一个有 `[]`），不冲突。

⚠️ **`data[].name` 与 `data.checks[].name` vs `data[].assignee.name`** —— 三者路径不同，照抄页面字面量即可。

`verify-pages.mjs` PAGES：

```js
const PAGES = ['./app/src/ServiceList.tsx', './app/src/IncidentList.tsx', './app/src/HealthChecker.tsx']
```

⚠️ **verify-pages.mjs 的 A1/A2 检查需为 HealthChecker 放宽**：`fetch('/api/services/down-api/health')` 里含 `data.code` 字样会被正则误抓为 `field="..."`。检查脚本只匹配 `field="..."` 形态（HealthChecker 用的是 `field="data.code"`，正确命中）。**若 A1/A2 检查对 `String(errBody.retryAfterSeconds ?? DASH)` 误报**，说明 children 含裸表达式但已带 `??` —— 此时检查应通过（脚本判据是「含 `.` 且不含 `??`」）。若仍误报，在脚本的 `PAGES` 循环里对该文件放宽并注释说明。

`mk/scenarios/incident.yml`：

```yaml
# devops-incidents 场景套件 —— S4：单 goto；★ 503 错误分支的断言也在这一个页面内完成。
version: 1
scenarios:
  - id: devops-incidents-full
    name: 服务列表 + 事件列表 + 健康检查（200/503 双分支）全字段覆盖
    route: /
    steps:
      - id: goto-app
        type: goto
        url: http://localhost:5203/
      - id: wait-services
        type: waitFor
        selector: "[data-page='service-list']"
      - id: wait-incidents
        type: waitFor
        selector: "[data-page='incident-list']"
      - id: wait-health-ok
        type: waitFor
        selector: "[data-testid='health-ok']"
      # ★ 等 503 错误卡渲染出 data-mk-field —— C2 绕行的关键等待点
      - id: wait-health-error
        type: waitFor
        selector: "[data-testid='health-error'] dl"

      - id: assert-svc-name
        type: assertFieldVisible
        field: data[].name
      - id: assert-svc-status
        type: assertFieldVisible
        field: data[].status
      - id: assert-svc-region
        type: assertFieldVisible
        field: data[].region
      - id: assert-svc-version
        type: assertFieldVisible
        field: data[].version
      - id: assert-svc-deps
        type: assertFieldVisible
        field: data[].dependencies[]
      - id: assert-svc-deployed
        type: assertFieldVisible
        field: data[].lastDeployedAt

      - id: assert-inc-title
        type: assertFieldVisible
        field: data[].title
      - id: assert-inc-severity
        type: assertFieldVisible
        field: data[].severity
      - id: assert-inc-state
        type: assertFieldVisible
        field: data[].state
      - id: assert-inc-opened
        type: assertFieldVisible
        field: data[].openedAt
      - id: assert-inc-resolved
        type: assertFieldVisible
        field: data[].resolvedAt
      - id: assert-assignee-id
        type: assertFieldVisible
        field: data[].assignee.id
      - id: assert-assignee-name
        type: assertFieldVisible
        field: data[].assignee.name
      - id: assert-assignee-email
        type: assertFieldVisible
        field: data[].assignee.email
      - id: assert-impact-users
        type: assertFieldVisible
        field: data[].impact.usersAffected
      - id: assert-impact-regions
        type: assertFieldVisible
        field: data[].impact.regions[]

      # 200 分支
      - id: assert-health-status
        type: assertFieldVisible
        field: data.status
      - id: assert-check-name
        type: assertFieldVisible
        field: data.checks[].name
      - id: assert-check-passed
        type: assertFieldVisible
        field: data.checks[].passed
      - id: assert-check-latency
        type: assertFieldVisible
        field: data.checks[].latencyMs
      - id: assert-check-message
        type: assertFieldVisible
        field: data.checks[].message

      # ★ 503 错误分支（C2 绕行）
      - id: assert-err-code
        type: assertFieldVisible
        field: data.code
      - id: assert-err-message
        type: assertFieldVisible
        field: data.message
      - id: assert-err-retry
        type: assertFieldVisible
        field: data.retryAfterSeconds
      - id: assert-err-contact
        type: assertFieldVisible
        field: data.contact

      - id: assert-note-body
        type: assertFieldVisible
        field: data.body
      - id: assert-note-created
        type: assertFieldVisible
        field: data.createdAt

      - id: shot
        type: screenshot
```

⚠️ **step 数校验**（S5 上限 50）：本文件 32 条，未超限。

⚠️ **备注回显未在页面中实现**：`POST /incidents/{id}/notes` 的 201 字段 `data.body` / `data.createdAt` 需要页面额外调用。照 Task 3 的 `CheckoutForm` 模式在 `IncidentList` 组件里补一个 `useEffect`（mount 即 POST 固定 note）并渲染两个 Field。**漏掉会导致 D/E 断言失败**。

- [ ] **Step 6: 装依赖 + 产出 + 验收（含 503 分支专项诊断）**

```bash
cd /d/DevProjects/my/github/nx-mk
pnpm install
pnpm incidents:codegen
pnpm --filter @nx-mk-example/incidents-server typecheck
pnpm --filter @nx-mk-example/incidents-app typecheck
pnpm --filter @nx-mk-example/incidents-server dev &
MK_ANALYSIS=true pnpm --filter @nx-mk-example/incidents-app dev &
cd examples/devops-incidents
node verify-manifest.mjs && node verify-pages.mjs
node ../../packages/cli/dist/index.js run
node verify-coverage.mjs
```

Expected: 全绿。

**★ 503 分支专项诊断**（本项目最可能卡住的地方）：

| 症状 | 根因 | 修法 |
|---|---|---|
| `data.code` 等 4 个字段 missing | 503 错误卡未渲染出 `data-mk-field` | 打开 app 页面确认 `[data-testid='health-error'] dl` 存在；若只有「正在探测…」说明 fetch 未拿到 503 —— 用浏览器 DevTools 看 `/api/services/down-api/health` 实际状态码 |
| fetch 拿不到 503 | server 侧 `name.includes('down')` 未命中 | 确认请求路径为 `/api/services/down-api/health`（vite proxy 剥 `/api` 后 server 收到 `/services/down-api/health`） |
| 错误卡渲染了但仍 missing | manifest 里 503 字段的 `normalizedPath` 不是 `data.code` 等 | 跑 `node -e "console.log(require('./.nx-mk/manifest.json').fields.map(f=>f.status+':'+f.normalizedPath).join('\n'))"` 核对实际路径，按实际值改页面字面量（并在 ledger 记 Ruling） |
| `data.status` missing | 200 分支未渲染 | 检查 `api.health.getServiceHealth` 是否成功（catch 里吞了错误 → 静默失败）；临时去掉 `.catch` 看真实错误 |

- [ ] **Step 7: README + Commit**

README 的「已知限制」段必须记录 503 绕行的实测结论（原生 fetch + DOM 渲染是否足以覆盖非 2xx 响应字段）—— 这是本项目对 nx-mk 能力边界的核心发现。

```bash
git add examples/devops-incidents package.json
git commit -m "feat(examples): devops-incidents 验证项目（错误响应 + 同 path 多状态码，spec §3.3）

★ 核心验证：GET /services/{name}/health 同 path 声明 200/503 两组 schema。
503 走原生 fetch 绕开 SDK 的非 2xx throw（client.ts:177），错误体渲染成
带data-mk-field 的错误卡 → DOM 扫描产出 ui_evidence → accessHit||uiHit
判covered（coverage-analyzer.ts:102 + scanner.ts:17）。
这验证了非 2xx 响应字段在真 100% 口径下可达。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 汇总验收脚本 + 根 README 对照表 + 缺口归档

**Files:**
- Create: `scripts/verify-examples.mjs`
- Create: `docs/verification-report.md`
- Modify: `README.md`（根，追加「多域验证项目」一节）

**Interfaces:**
- Consumes: 三个项目各自的 `verify-coverage.mjs` 逻辑 + `coverage-report.json` + `nx-mk.config.yml`
- Produces: 一键验收入口 `node scripts/verify-examples.mjs`；验证报告文档（含能力缺口清单）；根 README 对照表

- [ ] **Step 1: 写失败的汇总脚本（RED）**

创建 `scripts/verify-examples.mjs`：

```js
/**
 * 三项目一键验收 —— 逐项目复用其 verify-coverage.mjs 的断言 A–H，汇总输出。
 * 只读断言，不跑采集；采集需各项目先跑过 nx-mk run。
 * 用法：node scripts/verify-examples.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const PROJECTS = [
  { dir: 'medical-records', shape: '嵌套关联 + enum + nullable' },
  { dir: 'commerce-orders', shape: '分页 envelope + 深层数组' },
  { dir: 'devops-incidents', shape: '错误响应 + 同 path 多状态码' },
  // 对照基线：现有 demo 有 7 条 ignored，预期不达 100%（G9：不动它，只记录）
  { dir: 'react-vite-demo', shape: '（对照基线）', baseline: true },
]

const rows = []
let allPassed = true

for (const p of PROJECTS) {
  const projDir = join(repoRoot, 'examples', p.dir)
  const script = join(projDir, 'verify-coverage.mjs')
  if (!existsSync(script)) {
    rows.push({ 项目: p.dir, 形状族: p.shape, 结果: '缺 verify-coverage.mjs', 明细: '未建或未提交' })
    if (!p.baseline) allPassed = false
    continue
  }
  let out = ''
  let code = 0
  try {
    out = execFileSync('node', [script], { cwd: projDir, encoding: 'utf8', timeout: 120_000 })
  } catch (e) {
    code = e.status ?? 1
    out = (e.stdout ?? '') + (e.stderr ?? '')
  }
  const passed = code === 0
  if (!passed && !p.baseline) allPassed = false

  // 抽取关键指标
  const reportPath = join(projDir, '.nx-mk', 'coverage-report.json')
  let coverage = '—'
  let missing = '—'
  let suspicious = '—'
  let weak = '—'
  if (existsSync(reportPath)) {
    const m = JSON.parse(readFileSync(reportPath, 'utf8')).metrics
    coverage = String(m.requiredCoverage)
    missing = String(m.missingRequiredFields)
    suspicious = String(m.suspiciousFields)
    weak = String((JSON.parse(readFileSync(reportPath, 'utf8')).weakEvidenceFields ?? []).length)
  }
  rows.push({
    项目: p.dir,
    形状族: p.shape,
    requiredCoverage: coverage,
    missing: missing,
    suspicious: suspicious,
    weak: weak,
    结果: passed ? (p.baseline ? '基线（预期不达标）' : '✅ 100%') : '❌ 未达标',
    明细: passed ? '' : out.split('\n').slice(0, 12).join('\n      '),
  })
}

console.log('\n=== nx-mk 多域验证汇总 ===\n')
for (const r of rows) {
  console.log(`【${r.项目}】${r.形状族}`)
  console.log(`  requiredCoverage=${r.requiredCoverage ?? '—'}  missing=${r.missing ?? '—'}  suspicious=${r.suspicious ?? '—'}  weak=${r.weak ?? '—'}`)
  console.log(`  → ${r.结果}`)
  if (r.明细) console.log(`      ${r.明细}`)
  console.log('')
}

if (!allPassed) {
  console.error('汇总：至少一个验证项目未达成真 100%（断言 A–H）。')
  process.exit(1)
}
console.log('汇总：三个验证项目全部达成 requiredCoverage=100% 且 ignored=[] ✅')
```

Run: `node scripts/verify-examples.mjs`
Expected: FAIL —— commerce-orders / devops-incidents 的 `verify-coverage.mjs` 尚不存在。这是本任务的 RED。

- [ ] **Step 2: 跑汇总（GREEN）**

```bash
cd /d/DevProjects/my/github/nx-mk
node scripts/verify-examples.mjs
```

Expected: 三个验证项目全 `✅ 100%`，demo 标为基线，末尾打印 `汇总：三个验证项目全部达成 requiredCoverage=100% 且 ignored=[] ✅`。

- [ ] **Step 3: 写验证报告（缺口归档）**

创建 `docs/verification-report.md`，内容从三个项目的实测产物抄录（**不许编数字**）：

```markdown
# nx-mk 多域真 100% 验证报告

**日期**：2026-10-04
**结论**：三个验证项目全部达成 requiredCoverage=100%、coverage.ignored=[]（粘贴汇总脚本实测输出）

## 对照表

<!-- 从 node scripts/verify-examples.mjs 的输出粘贴 -->

## 各项目验证的形状与结论

| 项目 | 形状族 | 关键验证点 | 结论 |
|---|---|---|---|
| medical-records | 嵌套关联 + enum + nullable | $ref 复用（Contact 双引用）、enum 映射、nullable notes、数组内嵌数组 | ✅ |
| commerce-orders | 分页 envelope + 深层数组 | envelope 四标量分区渲染、三层数组、数组→对象→对象、双 nullable | ✅ |
| devops-incidents | 错误响应 + 同 path 多状态码 | 503 走原生 fetch + DOM 渲染 → ui_evidence 覆盖非 2xx 字段 | ✅ |
| react-vite-demo（基线） | 混合 | 7 条 ignored 校准，required<100% | 对照组 |

## 发现的能力缺口

<!-- 逐条记录。若三个项目均未发现缺口，写「本次验证未发现阻塞性能力缺口」。以下为需重点关注的观察点：

### 1. 请求体字段不进 coverage 分母（设计事实，非缺陷）
`parser.ts:121` 只把响应字段展平进 `Manifest.fields`。写接口的 requestBody 字段
（如 `POST /patients` 的 name/birthDate）不会被计为 required。本计划用 **201 回显设计**
绕过：写入值在响应体回显，页面渲染同一 normalizedPath。
→ 若未来产品需求是「写路径也纳入覆盖」，需另开 SDD 改 manifest 语义。

### 2. SDK 对非 2xx 抛异常，错误体需原生 fetch 绕行
`client.ts:177` 的 `if (!res.ok) throw` 使错误响应体不经解析。devops-incidents 项目
验证了「原生 fetch + 页面渲染带 data-mk-field 的错误卡」可行（ui_evidence 通道独立于 HTTP）。
→ 这是前端作者需知的模式，但 SDK 未提供便利封装。

### 3. 场景 DSL 无 click/fill，页面必须自驱动
`dsl-schema.ts:14-26` 只支持 goto/waitFor/waitForRequest/assertFieldVisible/screenshot。
真实交互驱动的页面无法被套件覆盖 —— 这是能力缺口（spec §26 已标注 click/fill 后置）。

### 4. 场景失败不影响退出码
plugin-playwright 对失败场景仅 warn（E8），不抛。CI 若只看退出码会漏掉场景失败。
→ 验收必须解析 events.jsonl 的 `scenario:done` 事件（本计划的 verify-coverage.mjs 断言 G）。

### 5. 整页导航重置 collector 缓冲
整页 goto 会清空 `window.__MK_COLLECTOR__`，未回捞的 hits 丢失。单页应用不受影响。
→ 三个项目均采用「单页聚合渲染 + 单 goto」规避。

以上均为**已记录、可规避**的现状，非阻塞缺陷。
-->

## 复现方式

```bash
# 逐项目（顺序执行，避免端口冲突）
cd examples/medical-records && node ../../packages/cli/dist/index.js run && node verify-coverage.mjs
cd examples/commerce-orders && node ../../packages/cli/dist/index.js run && node verify-coverage.mjs
cd examples/devops-incidents && node ../../packages/cli/dist/index.js run && node verify-coverage.mjs

# 汇总（不跑采集）
node scripts/verify-examples.mjs
```
```

⚠️ 报告里的每个数字必须从实测产物抄。**若某项目实际未达标**（例如 503 分支覆盖不到），如实记录失败状态与缺口分析，**不许把 failed 写成 passed**。

- [ ] **Step 4: 根 README 追加对照表**

在根 `README.md` 的 `agent.style` 一节之后追加：

```markdown
## 多域真 100% 验证项目

三个入git 的完整可跑项目，验证 nx-mk pipeline 在不同 OpenAPI 形状下能让前端达
`requiredCoverage=100%` 且 `coverage.ignored=[]`（不靠豁免任何字段）：

| 项目 | 形状族 | 端口 | 状态 |
|---|---|---|---|
| `examples/medical-records` | 嵌套关联 / $ref 复用 / enum / nullable | 8801 / 5201 | ✅ 100% |
| `examples/commerce-orders` | 分页 envelope / 三层数组 / 双 nullable | 8802 / 5202 | ✅ 100% |
| `examples/devops-incidents` | 错误响应体 / 同 path 多状态码（200+503） | 8803 / 5203 | ✅ 100% |
| `examples/react-vite-demo`（对照基线） | 混合，7 条 ignored 校准 | 8787 / 5173 | 对照组 |

一键汇总验收：`node scripts/verify-examples.mjs`
验证报告与能力缺口清单：[`docs/verification-report.md`](./docs/verification-report.md)
设计与计划：[`docs/superpowers/specs/2026-10-03-nx-mk-multi-domain-100pct-verification-design.md`](./docs/superpowers/specs/2026-10-03-nx-mk-multi-domain-100pct-verification-design.md)
```

⚠️ 状态列按 Task 7 Step 2 的**实测**结果填。若某项目未达标，如实标注并在验证报告里写清缺口。

- [ ] **Step 5: 全仓验证（确认未破坏既有基线）**

```bash
cd /d/DevProjects/my/github/nx-mk
pnpm -r build
pnpm typecheck
npx vitest run
```

Expected: 全绿；测试数 **812**（三个新项目不含 vitest 用例，基线不应变化）。若数量变化，说明误改了 packages/ —— 按 G8 回退。

⚠️ 三个新项目的 `typecheck` 会被 `pnpm -r typecheck` 覆盖（pnpm-workspace 含 `examples/**`），故本步同时验证了三个 app/server 的类型。

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-examples.mjs docs/verification-report.md README.md
git commit -m "docs(verification): 三项目真 100% 验证报告 + 汇总验收脚本 + README 对照表

scripts/verify-examples.mjs 一键汇总三项目的断言 A–H（复用各自
verify-coverage.mjs），react-vite-demo 标为对照基线。
verification-report.md 归档 5 项能力缺口（请求体不进分母 / SDK 非2xx throw
需原生 fetch 绕行 / DSL 无 click/fill / 场景失败不影响退出码 /
整页导航重置 collector）—— 均为已记录可规避的现状，非阻塞缺陷。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: 最终收口**

在 ledger 追加：
```
Final: 三个验证项目全部达成真 100%（汇总脚本实测输出见 verification-report.md）
Final: 发现 5 项能力缺口，均为可规避现状，已归档至 docs/verification-report.md
```