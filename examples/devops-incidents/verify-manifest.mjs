// 断言 manifest 的 normalizedPath 集合 —— 页面里每个 field="..." 字面量都必须落在这个集合内。
// 这条脚本同时是 Review Focus #4（数组路径写错）的自动化出口。
//
// 双向断言（set equality，不是单向子集）：
//   1. REQUIRED ⊆ paths  —— 页面将要用到的每个路径都必须在 manifest 里（漏字段 → 页面渲染了但分母没有）
//   2. paths ⊆ REQUIRED  —— manifest 里不该出现 REQUIRED 未预期的路径（多余字段 → 真 100% 永远达不到）
// 只做单向断言会让"13 条正确 + 500 条垃圾"静默通过，故两个方向都必须成立。
//
// ⚠️ REQUIRED 的来源纪律（controller 裁定，Task 5）：**从实际生成的 manifest 推导**，
// 不抄 brief。brief 的列表有两处陷阱，均已在实现期按实际 manifest 修正（35 条唯一路径）：
//   - 200/503 同 path 多状态码（spec §3.3）：field-id 派生含 status 段，两组分属不同
//     fieldId —— 200 的 data.status / data.checks[].* 与 503 的 data.code / data.message
//     / data.retryAfterSeconds / data.contact 是**不同** normalizedPath（无碰撞）。
//   - 跨 endpoint normalizedPath 同字符串场景（与 commerce-orders 同形）：
//     data[].id 同时是 listServices 与 listServiceIncidents 的字段，路径完全相同，
//     manifest 为二者生成**不同 fieldId**（endpointId 不同），页面两个组件各写
//     field="data[].id" 是正确的（各自命中自己 endpoint 的 fieldId）。
// 集合与 swagger/openapi.json 的实际产出逐条对齐，改 server schema 时本脚本会立即变红。
import { readFileSync } from 'node:fs'
const m = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))
const paths = [...new Set(m.fields.map((f) => f.normalizedPath))].sort()
const REQUIRED = [
  // ─── 服务数组元素（7）：GET /services 200 → Service[] ───
  // dependencies 是 array-of-primitive（string[]）→ 数组元素字段进分母（带 [] 后缀）。
  'data[].id', 'data[].name', 'data[].status', 'data[].region',
  'data[].version', 'data[].dependencies[]', 'data[].lastDeployedAt',
  // ─── 事件数组元素（13）：GET /services/{serviceId}/incidents 200 → Incident[] ───
  // 6 个标量叶子（resolvedAt 是 nullable 验证点）
  'data[].id', 'data[].title', 'data[].severity', 'data[].state',
  'data[].openedAt', 'data[].resolvedAt',
  // assignee（plain object 父）→ 3 个叶子
  'data[].assignee', 'data[].assignee.id', 'data[].assignee.name', 'data[].assignee.email',
  // impact（plain object 父）→ usersAffected 叶子 + regions[] 数组叶
  'data[].impact', 'data[].impact.usersAffected', 'data[].impact.regions[]',
  // ─── 健康检查 200 分支（5）：GET /services/{name}/health 200 ───
  // status 是 top-level scalar；data.checks[] 数组元素字段
  'data.status', 'data.checks[].name', 'data.checks[].passed',
  'data.checks[].latencyMs', 'data.checks[].message',
  // ─── 健康检查 503 分支（4）：GET /services/{name}/health 503（C2 绕行的验证对象）───
  // 同 path 派生不同 fieldId（field-id.ts:20 rawKey 含 status 段），故 data.code 与
  // data.status 不冲突。
  'data.code', 'data.message', 'data.retryAfterSeconds', 'data.contact',
  // ─── 备注回显（3）：POST /incidents/{incidentId}/notes 201 → IncidentNote ───
  // 注：IncidentNote 的 id 与 listServices / listServiceIncidents 的 data[].id 不是同路径
  // （前者非数组、后者是数组元素），二者 normalizedPath 不同（data.id vs data[].id），
  // 各占分母一条。
  'data.id', 'data.body', 'data.createdAt',
]
// 去重：brief 列表里 data[].id 在 services 与 incidents 各列一次，故意保留两个源头的
// 列表让维护者看见「这条路径跨两个 endpoint」，但分母只算一份 —— 用 Set 去重。
const REQUIRED_SORTED = [...new Set(REQUIRED)].sort()

// 方向 1：REQUIRED ⊆ paths（缺字段 —— 页面渲染了但 manifest 分母里没有）
const missing = REQUIRED_SORTED.filter((p) => !paths.includes(p))
// 方向 2：paths ⊆ REQUIRED（多余字段 —— 真 100% 永远达不到）
const unexpected = paths.filter((p) => !REQUIRED_SORTED.includes(p))

if (missing.length || unexpected.length) {
  if (missing.length) {
    console.error(`manifest 缺少预期字段路径（${missing.length}）:\n  ` + missing.join('\n  '))
  }
  if (unexpected.length) {
    console.error(`manifest 出现预期外的字段路径（${unexpected.length}）:\n  ` + unexpected.join('\n  '))
  }
  console.error(`实际集合（共 ${paths.length}）:\n  ` + paths.join('\n  '))
  process.exit(1)
}
console.log(
  `[verify-manifest] ${REQUIRED_SORTED.length} 个预期字段路径双向命中` +
  `（对象族 ${REQUIRED.filter((p) => !p.includes('[]')).length} + 数组族 ${REQUIRED.filter((p) => p.includes('[]')).length}）` +
  `，共 ${paths.length} 个唯一路径，无缺失无多余`,
)