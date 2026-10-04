// 断言 manifest 的 normalizedPath 集合 —— 页面里每个 field="..." 字面量都必须落在这个集合内。
// 这条脚本同时是 Review Focus #4（数组路径写错）的自动化出口。
//
// 双向断言（set equality，不是单向子集）：
//   1. REQUIRED ⊆ paths  —— 页面将要用到的每个路径都必须在 manifest 里（漏字段 → 页面渲染了但分母没有）
//   2. paths ⊆ REQUIRED  —— manifest 里不该出现 REQUIRED 未预期的路径（多余字段 → 真 100% 永远达不到）
// 只做单向断言会让"13 条正确 + 500 条垃圾"静默通过，故两个方向都必须成立。
//
// REQUIRED 覆盖两种形状族：
//   - 对象族 data.*            —— 嵌套对象 / $ref 复用（Contact/EmergencyContact/Insurance/VitalSigns）
//   - 数组族 data[].*           —— 数组内嵌数组（medications[]），验证项目一的核心命题
// 集合与 swagger/openapi.json 的实际产出逐条对齐，改 server schema 时本脚本会立即变红。
import { readFileSync } from 'node:fs'
const m = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))
const paths = [...new Set(m.fields.map((f) => f.normalizedPath))].sort()
const REQUIRED = [
  // ─── 对象族（16）：GET /patients/{patientId} 200 → Patient ───
  'data.id', 'data.name', 'data.birthDate', 'data.gender', 'data.bloodType',
  // plain-object 父节点：walkSchema 对 object 属性会产父描述符（与 array 相反）
  'data.contact', 'data.contact.phone', 'data.contact.email',
  'data.emergencyContact', 'data.emergencyContact.name', 'data.emergencyContact.relation',
  'data.insurance', 'data.insurance.policyNumber', 'data.insurance.expiryDate',
  'data.lastVisitAt', 'data.notes',
  // ─── 数组族（11）：GET /patients/{patientId}/visits 200 → Visit[] ───
  // 注意：数组属性自身（data[].medications[]）不进 manifest —— walkSchema 对 array-of-object
  // 不产描述符，只透传元素字段（packages/manifest-schema/src/schema-walker.ts:102-107）。
  // 故下面只列叶子与 plain-object 父节点（data[].vitals 是 object，会产描述符）。
  'data[].id', 'data[].visitAt', 'data[].department', 'data[].diagnosis',
  'data[].vitals',
  'data[].vitals.heartRate', 'data[].vitals.heightCm', 'data[].vitals.weightKg',
  // 数组内嵌数组：medications[] 的三个叶子
  'data[].medications[].name', 'data[].medications[].dosage', 'data[].medications[].prescribed',
  // ─── 回显族（2）：POST /patients 201 → CreatedPatient（P1/C1 回显设计）───
  'data.createdAt',
]
const REQUIRED_SORTED = [...REQUIRED].sort()

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
  `（对象族 ${REQUIRED.filter((p) => !p.includes('data[]')).length} + 数组族 ${REQUIRED.filter((p) => p.includes('data[]')).length}）` +
  `，共 ${paths.length} 个唯一路径，无缺失无多余`,
)
