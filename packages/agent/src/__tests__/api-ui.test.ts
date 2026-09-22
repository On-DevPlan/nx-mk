/**
 * api-ui-agent 单测（spec §3.4/§3.5 + plan §44.4）：plan 渲染、prompt 约束、apply 错误分级。
 */
import { describe, it, expect } from 'vitest'
import { KernelError } from '@nx-mk/kernel'
import { buildPrompt, createApiUiAgent, planTasks } from '../agents/api-ui.js'
import type { AgentContext, AgentProvider, CoverageReport } from '../types.js'

function makeReport(): CoverageReport {
  return {
    runId: 'run_x',
    metrics: {
      requiredCoverage: 0.5, effectiveCoverage: 0.5, rawBackendFieldCoverage: 0.5,
      endpointsTotal: 0, endpointsCalled: 0, fieldsTotal: 0, fieldsReturned: 0,
      requiredFields: 0, missingRequiredFields: 0, ignoredReturnedFields: 0, suspiciousFields: 0,
    },
    missingRequiredFields: [
      { fieldId: 'GET /users.200.data.name', fieldPath: 'data.name', endpointId: 'getUsers', state: 'missing', policyStatus: 'required' },
      { fieldId: 'POST /orders.200.data.sku', fieldPath: 'data.sku', state: 'missing', policyStatus: 'required' },
    ],
    weakEvidenceFields: [], ignoredReturnedFields: [], suspiciousCoverage: [], endpoints: [], requests: [],
  }
}

function makeCtx(provider?: AgentProvider): AgentContext {
  return {
    report: makeReport(),
    manifestSummary: 'Manifest endpoints:\n- GET /users (called=true, fields 1/2)',
    policySummary: 'Policy summary: test',
    projectRoot: '/proj',
    ai: provider ?? { name: 'fake', edit: async () => ({ diffText: 'DIFF' }) },
    log: () => {},
  }
}

describe('planTasks', () => {
  it('renders every missingRequiredField as a render-field task (endpointId ?? null)', async () => {
    const plan = await planTasks(makeCtx())
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0]).toEqual({
      type: 'render-field',
      fieldId: 'GET /users.200.data.name',
      fieldPath: 'data.name',
      endpointId: 'getUsers',
      reason: expect.stringContaining('missing'),
    })
    expect(plan.tasks[1]?.endpointId).toBeNull()
  })
})

describe('buildPrompt', () => {
  it('contains the §44.4 constraints, field context and diff-only output instruction', async () => {
    const ctx = makeCtx()
    const agent = createApiUiAgent()
    const plan = await agent.plan(ctx) // EXEC-5：从 plan() 派生 AgentTask（报告项缺 type/reason，不是任务）
    const p = buildPrompt(plan.tasks[0]!, ctx)
    expect(p).toContain('data.name')
    expect(p).toContain('getUsers')
    expect(p).toContain('data-mk-field="GET /users.200.data.name"')
    expect(p).toContain('Never render fields that the policy marks as ignored')
    expect(p).toContain('Never dump a response object with JSON.stringify')
    expect(p).toContain('Never add console.log probes')
    expect(p).toContain(ctx.manifestSummary)
    // v1 质量杠杆：policySummary 进入 prompt（ignored ids 的具体枚举随 ctx 传入）
    expect(p).toContain(ctx.policySummary)
    expect(p).toContain('unified diff')
  })
})

describe('applyTasks', () => {
  it('returns diff-produced per task on provider success', async () => {
    const ctx = makeCtx()
    const applied = await createApiUiAgent().apply(ctx, { tasks: ctx.report.missingRequiredFields.map((f) => ({ type: 'render-field', fieldId: f.fieldId, fieldPath: f.fieldPath, endpointId: f.endpointId ?? null, reason: 'missing' })) })
    expect(applied.results).toHaveLength(2)
    expect(applied.results.every((r) => r.status === 'diff-produced' && r.diffText === 'DIFF')).toBe(true)
  })

  it('converts provider failures to failed results (E5/E6)', async () => {
    const ctx = makeCtx({ name: 'fake', edit: async () => { throw new Error('no diff block found') } })
    const applied = await createApiUiAgent().apply(ctx, { tasks: [{ type: 'render-field', fieldId: 'f1', fieldPath: 'd', endpointId: null, reason: 'r' }] })
    expect(applied.results[0]?.status).toBe('failed')
    expect(applied.results[0]?.error).toContain('no diff')
  })

  it('propagates PROVIDER_UNAVAILABLE as process-level (E4)', async () => {
    const ctx = makeCtx({ name: 'fake', edit: async () => { throw new KernelError('PROVIDER_UNAVAILABLE', 'claude not found') } })
    await expect(createApiUiAgent().apply(ctx, { tasks: [{ type: 'render-field', fieldId: 'f1', fieldPath: 'd', endpointId: null, reason: 'r' }] }))
      .rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })
})
