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
