/**
 * review-agent 静态 guard 单测（spec §3.6 / R5 / R10 / D3）：
 * G1 四态 + G2 ignored-render + G3 json-dump + G4 console-probe + 只检 '+' 行。
 * G1 走已映射的注入替身（真实 git 全链在 T9）。
 */
import { describe, it, expect } from 'vitest'
import { verifyDiff } from '../agents/review.js'
import type { AgentApplyResult, AgentContext, CoverageReport } from '../types.js'

// 最小 report：只用到 ignoredReturnedFields
function makeReport(ignoredIds: string[] = []): CoverageReport {
  return {
    runId: 'run_x',
    metrics: {
      requiredCoverage: 0.5, effectiveCoverage: 0.5, rawBackendFieldCoverage: 0.5,
      endpointsTotal: 0, endpointsCalled: 0, fieldsTotal: 0, fieldsReturned: 0,
      requiredFields: 0, missingRequiredFields: 0, ignoredReturnedFields: ignoredIds.length,
      suspiciousFields: 0,
    },
    missingRequiredFields: [],
    weakEvidenceFields: [],
    ignoredReturnedFields: ignoredIds.map((id) => ({
      fieldId: id, fieldPath: id, state: 'ignored' as const, policyStatus: 'ignored' as const,
    })),
    suspiciousCoverage: [],
    endpoints: [],
    requests: [],
  }
}

function makeCtx(report = makeReport()): AgentContext {
  return {
    report,
    manifestSummary: 'Manifest endpoints: (none)',
    policySummary: 'Policy summary: test',
    projectRoot: '/proj',
    ai: { name: 'fake', edit: async () => ({ diffText: '' }) },
    log: () => {},
  }
}

function oneResult(diffText: string): AgentApplyResult {
  return {
    results: [{ task: { type: 'render-field', fieldId: 'f1', fieldPath: 'data.name', endpointId: null, reason: 'missing' }, status: 'diff-produced', diffText, patchRelPath: '.nx-mk/patches/x/p.patch' }],
  }
}

const PASS_G1 = async () => 'pass' as const
const REJECT_G1 = async () => 'reject' as const
const SKIP_G1 = async () => 'skipped' as const

describe('verifyDiff', () => {
  it('G1: rejects when git apply --check fails (E7)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult('+ok'), { applyCheck: REJECT_G1 })
    expect(vr.verdict).toBe('reject')
    expect(vr.checks.find((c) => c.name === 'apply-check')?.outcome).toBe('reject')
  })

  it('G1: passes on exit 0', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult('+ok'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
  })

  it('G1: skipped on non-git dir — verdict decided by static rules only (R10)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult('+ok'), { applyCheck: SKIP_G1 })
    expect(vr.verdict).toBe('pass')
    expect(vr.checks.find((c) => c.name === 'apply-check')?.outcome).toBe('skipped')
  })

  it('G2: rejects data-mk-field pointing at an ignored field id (D3)', async () => {
    const ctx = makeCtx(makeReport(['data.internalRiskScore']))
    const vr = await verifyDiff(ctx, oneResult('+  <span data-mk-field="data.internalRiskScore">{x}</span>'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('reject')
    expect(vr.checks.find((c) => c.name === 'ignored-render')).toBeTruthy()
  })

  it('G2: non-ignored data-mk-field passes', async () => {
    const ctx = makeCtx(makeReport(['data.internalRiskScore']))
    const vr = await verifyDiff(ctx, oneResult('+  <span data-mk-field="data.name">{x}</span>'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
  })

  it('G3: rejects JSON.stringify with response-like context nearby (R5)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult([
      '+  const out = JSON.stringify(res.data)',
      '+  return <pre>{out}</pre>',
    ].join('\n')), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('reject')
    expect(vr.checks.find((c) => c.name === 'json-dump')).toBeTruthy()
  })

  it('G3: JSON.stringify without response context passes (false-positive exemption)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult('+  const s = JSON.stringify(configSnapshot)'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
  })

  it('G4: rejects console.log mentioning field/coverage (R5)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult("+  console.log('field hit', f)"), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('reject')
    expect(vr.checks.find((c) => c.name === 'console-probe')).toBeTruthy()
  })

  it('only added lines are checked — context lines never trigger', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult([
      ' const unchanged = 1',
      "-  console.log('field old', f)",
      "+  const ready = true",
    ].join('\n')), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
  })

  it('failed tasks get a skipped apply-check and do not fail the verdict', async () => {
    const vr = await verifyDiff(makeCtx(), {
      results: [{ task: { type: 'render-field', fieldId: 'f1', fieldPath: 'd', endpointId: null, reason: 'r' }, status: 'failed', error: 'no diff' }],
    }, { applyCheck: REJECT_G1 })
    expect(vr.verdict).toBe('pass')
    expect(vr.checks[0]?.outcome).toBe('skipped')
  })
})

// ---- G5 classname-whitelist（spec 2026-10-02 §2.5）----
// makeCtx / oneResult / PASS_G1 复用上方既有定义；宿主集合走 inject.hostClasses 注入替身（不落盘扫描）
import type { StyleTemplate } from '../style/types.js'

const TPL: StyleTemplate = {
  id: 'tailwind-lite', source: 'built-in',
  classNameWhitelist: ['flex', 'px-*', 'text-sm'],
  description: 'd', rules: ['r'],
}

function ctxWithStyle(style: StyleTemplate | undefined): AgentContext {
  return { ...makeCtx(), style }
}

const HOST = { hostClasses: new Set(['legacy-btn']) }

describe('verifyDiff — G5 classname-whitelist', () => {
  it('no ctx.style → no classname-whitelist check entries at all (DS3)', async () => {
    const vr = await verifyDiff(ctxWithStyle(undefined), oneResult('+<div className="anything-goes">x</div>'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
    expect(vr.checks.find((c) => c.name === 'classname-whitelist')).toBeUndefined()
  })

  it('tokens in template whitelist or host classes pass, check entry recorded', async () => {
    const vr = await verifyDiff(ctxWithStyle(TPL), oneResult('+<div className="flex px-4">x</div>'), { applyCheck: PASS_G1, ...HOST })
    expect(vr.verdict).toBe('pass')
    expect(vr.checks.find((c) => c.name === 'classname-whitelist')?.outcome).toBe('pass')
    const withHost = await verifyDiff(ctxWithStyle(TPL), oneResult('+<button className="legacy-btn">x</button>'), { applyCheck: PASS_G1, ...HOST })
    expect(withHost.verdict).toBe('pass')
  })

  it('off-whitelist token rejects with token list and zero-host hint (spec §3)', async () => {
    const vr = await verifyDiff(ctxWithStyle(TPL), oneResult('+<div className="flex frobnicate">x</div>'), { applyCheck: PASS_G1, hostClasses: new Set() })
    expect(vr.verdict).toBe('reject')
    const g5 = vr.checks.find((c) => c.name === 'classname-whitelist')
    expect(g5?.outcome).toBe('reject')
    expect(g5?.detail).toContain('frobnicate')
    expect(g5?.detail).toContain('（宿主未检出任何既有 class')
    // 宿主非空时不附提示
    const vr2 = await verifyDiff(ctxWithStyle(TPL), oneResult('+<div className="frobnicate">x</div>'), { applyCheck: PASS_G1, ...HOST })
    expect(vr2.checks.find((c) => c.name === 'classname-whitelist')?.detail).not.toContain('宿主未检出')
  })

  it('template without whitelist → host-only oracle (all off-host tokens reject)', async () => {
    const NO_WL: StyleTemplate = { ...TPL, classNameWhitelist: undefined }
    const ok = await verifyDiff(ctxWithStyle(NO_WL), oneResult('+<div className="legacy-btn">x</div>'), { applyCheck: PASS_G1, ...HOST })
    expect(ok.verdict).toBe('pass')
    const bad = await verifyDiff(ctxWithStyle(NO_WL), oneResult('+<div className="tailwind-class">x</div>'), { applyCheck: PASS_G1, ...HOST })
    expect(bad.verdict).toBe('reject')
  })
})
