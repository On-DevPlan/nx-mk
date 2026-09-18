/**
 * review-agent（spec §3.6 / U3）—— v0 纯静态规则引擎，不调 AI：
 * G1 git apply --check；G2 ignored-render；G3 json-dump；G4 console-probe。
 * 只检查 diff 新增行（'+' 开头、非 '+++'）；任一 reject 即该 diff 不进 accepted 清单。
 */
import { join } from 'node:path'
import { gitApplyCheck } from '../patches.js'
import {
  defineCoverageAgent,
  type AgentApplyResult,
  type AgentContext,
  type AgentVerifyResult,
  type CoverageAgentPlugin,
} from '../types.js'

// 新增行：'+' 开头且非 '+++'（git unified diff 头不算新增内容）
export function addedLines(diffText: string): string[] {
  return diffText.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++'))
}

const DATA_MK_FIELD = /data-mk-field=["']([^"']+)["']/g
const JSON_STRINGIFY = /JSON\.stringify\(/
const RESPONSE_CONTEXT = /\bresponse\b|\bres\.|\bdata\b/i
const CONSOLE_LOG = /console\.log\(/
const FIELD_WORD = /\bfield\b|\bcoverage\b/i

// G1 的可注入缝（已映射结果）；默认走真实 gitApplyCheck
export type ApplyCheckFn = (patchAbsPath: string, cwd: string) => Promise<'pass' | 'reject' | 'skipped'>

export async function verifyDiff(
  ctx: AgentContext,
  result: AgentApplyResult,
  inject?: { applyCheck?: ApplyCheckFn },
): Promise<AgentVerifyResult> {
  const checkGit: ApplyCheckFn = inject?.applyCheck ?? ((p, c) => gitApplyCheck(p, c))
  const checks: AgentVerifyResult['checks'] = []
  let verdict: AgentVerifyResult['verdict'] = 'pass'
  const reject = (name: string, detail: string) => {
    checks.push({ name, outcome: 'reject', detail })
    verdict = 'reject'
  }

  // G2 的 ignored id 集合来自 report（R8：不读 manifest.json）
  const ignoredIds = new Set(ctx.report.ignoredReturnedFields.map((f) => f.fieldId))

  for (const r of result.results) {
    if (r.status !== 'diff-produced' || !r.patchRelPath) {
      checks.push({ name: 'apply-check', outcome: 'skipped', detail: 'no diff produced for this task' })
      continue
    }
    const patchAbs = join(ctx.projectRoot, r.patchRelPath)
    const g1 = await checkGit(patchAbs, ctx.projectRoot)
    const g1Detail = g1 === 'pass' ? undefined : g1 === 'skipped' ? 'not a git repository (R10)' : 'git apply --check failed (E7)'
    checks.push({ name: 'apply-check', outcome: g1, ...(g1Detail ? { detail: g1Detail } : {}) })
    if (g1 === 'reject') { verdict = 'reject'; continue }

    const lines = addedLines(r.diffText ?? '')
    // G2：ignored-render（D3）
    for (const line of lines) {
      for (const m of line.matchAll(DATA_MK_FIELD)) {
        const id = m[1]
        if (id && ignoredIds.has(id)) {
          reject('ignored-render', `data-mk-field="${id}" points at an ignored field (D3)`)
        }
      }
    }
    // G3：json-dump（同行或邻近 ±2 行含 response/res./data 上下文特征，R5）
    lines.forEach((line, i) => {
      if (!JSON_STRINGIFY.test(line)) return
      const window = lines.slice(Math.max(0, i - 2), i + 3)
      if (window.some((l) => RESPONSE_CONTEXT.test(l))) {
        reject('json-dump', 'JSON.stringify dump of response-like data used as UI content (R5)')
      }
    })
    // G4：console-probe（R5）
    for (const line of lines) {
      if (CONSOLE_LOG.test(line) && FIELD_WORD.test(line)) {
        reject('console-probe', 'console.log probe mentioning field/coverage (R5)')
      }
    }
  }
  return { verdict, checks }
}

export function createReviewAgent(): CoverageAgentPlugin {
  return defineCoverageAgent({
    name: 'review-agent',
    version: '0.1.0',
    capabilities: ['verify'],
    plan: async () => ({ tasks: [] }),
    apply: async () => ({ results: [] }),
    verify: verifyDiff,
  })
}
