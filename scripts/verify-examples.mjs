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