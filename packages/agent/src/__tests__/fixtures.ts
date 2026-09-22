/**
 * agent 测试共享 fixture（terminate/loop 两测试文件共用）。
 * 注意：独立于 *.test.ts 文件 —— vitest 会把被 import 的 *.test.ts 的用例
 * 在导入方文件下重复注册一遍（曾致 runtime-terminate 多计 5 条重复测试），
 * 共享替身一律放本文件，禁止测试文件互相 import。
 */
import type { AgentProvider, AgentTask, AgentVerifyResult, CoverageAgentPlugin, CoverageReport } from '../types.js'

export function makeReport(missing: number, ignoredIds: string[] = []): CoverageReport {
  return {
    runId: 'run_base',
    metrics: {
      requiredCoverage: 0.4, effectiveCoverage: 0.4, rawBackendFieldCoverage: 0.4,
      endpointsTotal: 1, endpointsCalled: 1, fieldsTotal: missing, fieldsReturned: missing,
      requiredFields: missing, missingRequiredFields: missing,
      ignoredReturnedFields: ignoredIds.length, suspiciousFields: 0,
    },
    missingRequiredFields: Array.from({ length: missing }, (_, i) => ({
      fieldId: `field_${i}`, fieldPath: `data.f${i}`, endpointId: 'getUsers',
      state: 'missing' as const, policyStatus: 'required' as const,
    })),
    weakEvidenceFields: [],
    ignoredReturnedFields: ignoredIds.map((id) => ({ fieldId: id, fieldPath: id, state: 'ignored' as const, policyStatus: 'ignored' as const })),
    suspiciousCoverage: [],
    endpoints: [{ endpointId: 'getUsers', method: 'GET', path: '/users', called: true, fieldsTotal: missing, fieldsCovered: 0 }],
    requests: [],
  }
}

export const OK_PROVIDER: AgentProvider = { name: 'fake', edit: async () => ({ diffText: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b' }) }

// 可编程 verdict 的 review-agent 替身：按 fieldId 前缀决定 pass/reject
export function scriptedReview(rule: (task: AgentTask) => 'pass' | 'reject'): CoverageAgentPlugin {
  return {
    name: 'scripted-review', version: '0.0.1', capabilities: ['verify'],
    plan: async () => ({ tasks: [] }),
    apply: async () => ({ results: [] }),
    verify: async (_ctx, result): Promise<AgentVerifyResult> => {
      const r = result.results[0]
      const verdict = r && rule(r.task) === 'reject' ? 'reject' : 'pass'
      return { verdict, checks: [{ name: 'scripted', outcome: verdict === 'pass' ? 'pass' : 'reject' }] }
    },
  }
}
