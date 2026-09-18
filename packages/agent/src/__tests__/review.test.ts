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
