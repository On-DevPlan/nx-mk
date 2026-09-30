/**
 * C7 三 agent 测试（§35.2/§35.3/§35.4）：plan 投影 → apply 产出；
 * dsl-agent 为确定性（无 provider 调用断言）、policy-agent 只建议不改 config。
 */
import { describe, it, expect, vi } from 'vitest'
import type { AgentContext, AgentProvider } from '../types.js'
import { createApiClientAgent, planApiCallTasks } from '../agents/api-client.js'
import { createDslAgent, applyDslTasks, planDslTasks } from '../agents/dsl.js'
import { createPolicyAgent, planPolicyTasks, collectPolicyObservations } from '../agents/policy.js'
import type { CoverageReport } from '@nx-mk/coverage'

// —— 共享替身 —————————————————————————————————————————————
function ctxOf(report: CoverageReport, provider?: AgentProvider): AgentContext {
  return {
    report,
    manifestSummary: 'Manifest endpoints:',
    policySummary: 'Policy summary',
    projectRoot: '.',
    ai: provider ?? { name: 'fake', edit: async () => ({ diffText: 'diff' }) },
    log: () => {},
  }
}

function reportWith(over: Partial<CoverageReport>): CoverageReport {
  return {
    runId: 'run_c7',
    metrics: {
      requiredCoverage: 0.5, effectiveCoverage: 0.5, rawBackendFieldCoverage: 0.5,
      endpointsTotal: 2, endpointsCalled: 1, fieldsTotal: 4, fieldsReturned: 2,
      requiredFields: 4, missingRequiredFields: 2, ignoredReturnedFields: 2, suspiciousFields: 1,
    },
    missingRequiredFields: [], weakEvidenceFields: [],
    ignoredReturnedFields: [
      { fieldId: 'i1', fieldPath: 'internal_flag', state: 'ignored', policyStatus: 'ignored', matchedRule: { source: 'config', pattern: 'internal_*', reason: 'internal only' } },
      { fieldId: 'i2', fieldPath: 'internal_extra', state: 'ignored', policyStatus: 'ignored', matchedRule: { source: 'config', pattern: 'internal_*' } },
    ],
    suspiciousCoverage: [
      { fieldId: 's1', fieldPath: 'debug_blob', state: 'covered', policyStatus: 'required', matchedRule: { source: 'builtin', pattern: 'debug_*' } },
    ],
    endpoints: [
      { endpointId: 'getUsers', method: 'GET', path: '/users', called: true, fieldsTotal: 4, fieldsCovered: 2 },
      { endpointId: 'postOrders', method: 'POST', path: '/orders', called: false, fieldsTotal: 2, fieldsCovered: 0 },
    ],
    requests: [
      { requestId: 't1', endpointId: 'getUsers', method: 'GET', url: 'http://x/api/users', path: '/api/users', status: 200 },
      { requestId: 't2', endpointId: 'getUsers', method: 'GET', url: 'http://x/api/users', path: '/api/users', status: 200 },
      { requestId: 't3', endpointId: 'postOrders', method: 'POST', url: 'http://x/api/orders', path: '/api/orders', status: 500 },
    ],
    ...over,
  } as CoverageReport
}

// —— api-client-agent（§35.2）——————————————————————————
describe('api-client-agent', () => {
  it('plan 只枚举未调用 endpoint（called=true 不进任务）', async () => {
    const plan = planApiCallTasks(ctxOf(reportWith({})))
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]).toMatchObject({ type: 'add-api-call', endpointId: 'postOrders', method: 'POST', path: '/orders' })
  })

  it('apply 走 provider.edit 产 diff；provider 失败 → failed 结果不抛', async () => {
    const edit = vi.fn(async () => ({ diffText: 'DIFF' }))
    const ctx = ctxOf(reportWith({}), { name: 'fake', edit })
    const plan = planApiCallTasks(ctx)
    const applied = await createApiClientAgent().apply(ctx, plan)
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ endpointId: 'postOrders' }) }))
    expect(applied.results[0]).toMatchObject({ status: 'diff-produced', diffText: 'DIFF' })

    const bad = ctxOf(reportWith({}), { name: 'fake', edit: async () => { throw new Error('boom') } })
    const failed = await applyTasksHelper(bad)
    expect(failed.results[0]?.status).toBe('failed')
    expect(failed.results[0]?.error).toContain('boom')
  }, 10_000)

  // 避免在测试里重复 plan → apply 样板
  async function applyTasksHelper(ctx: AgentContext) {
    const plan = planApiCallTasks(ctx)
    return createApiClientAgent().apply(ctx, plan)
  }
})

// —— dsl-agent（§35.3，确定性，C9 解锁）——————————————————
describe('dsl-agent', () => {
  it('plan 枚举全部捕获 trace 作候选', async () => {
    const ctx = ctxOf(reportWith({}))
    const plan = planDslTasks(ctx)
    expect(plan.tasks).toHaveLength(3) // 全 trace（含失败，剔除在 apply 阶段裁定）
    expect(plan.tasks[0]).toMatchObject({ type: 'add-request-dsl', method: 'GET', path: '/api/users', status: 200 })
  })

  it('apply 确定性生成：去重 + 失败剔除 + 不调 provider；diff 形状可过 addedLines', async () => {
    const spy = vi.fn(async () => { throw new Error('should not be called') })
    const ctx = ctxOf(reportWith({}), { name: 'fake', edit: spy })
    const applied = await applyDslTasks(ctx, planDslTasks(ctx))
    expect(spy).not.toHaveBeenCalled()
    // 去重：GET /api/users ×2 → 1 条；POST 500 → failed（明确原因）
    expect(applied.results[0]?.status).toBe('diff-produced')
    expect(applied.results[0]?.diffText).toMatch(/\+\s*-?\s*id: req_001/)
    expect(applied.results[0]?.diffText).toMatch(/\+\s*method: GET/)
    expect(applied.results[1]?.status).toBe('failed')
    expect(applied.results[1]?.error).toMatch(/duplicate|not eligible/)
  })

  it('生成的 YAML 可被 renderRequestDslYaml 消费回路还原（纯文本）', async () => {
    const applied = await applyDslTasks(ctxOf(reportWith({ requests: reportWith({}).requests.slice(0, 1) })), planDslTasks(ctxOf(reportWith({ requests: reportWith({}).requests.slice(0, 1) }))))
    expect(applied.results[0]?.status).toBe('diff-produced')
    expect(applied.results[0]?.diffText).toContain('+++ b/.nx-mk/runs/current/dsl.generated.yml')
  })
})

// —— policy-agent（§35.4）——————————————————————————————
describe('policy-agent', () => {
  it('observations 按 matchedRule 归组（suspicious 一组 + ignored 一组）', () => {
    const obs = collectPolicyObservations(ctxOf(reportWith({})))
    expect(obs).toHaveLength(2)
    expect(obs.map((o) => o.groupKey)).toEqual(['suspicious:debug_*', 'ignored:internal_*'])
    expect(obs[1]!.fields).toEqual(['internal_flag', 'internal_extra'])
  })

  it('plan 产出 suggest-policy 任务且 reason 承载归组摘要', async () => {
    const plan = planPolicyTasks(ctxOf(reportWith({})))
    expect(plan.tasks.every((t) => t.type === 'suggest-policy')).toBe(true)
    expect(plan.tasks[1]?.reason).toContain('internal only')
  })

  it('apply 只产建议 diff（不改 config；edit 指令含 advice-only 约束）', async () => {
    const edit = vi.fn(async () => ({ diffText: 'SUGGEST-DIFF' }))
    const ctx = ctxOf(reportWith({}), { name: 'fake', edit })
    const applied = await createPolicyAgent().apply(ctx, planPolicyTasks(ctx))
    expect(edit).toHaveBeenCalled()
    const call = edit.mock.calls[0] as [{ instructions: string; context?: Record<string, unknown> }] | undefined
    expect(call?.[0]?.instructions).toContain('advice only')
    expect(applied.results).toHaveLength(2)
    expect(applied.results.every((r) => r.status === 'diff-produced')).toBe(true)
  })
})
