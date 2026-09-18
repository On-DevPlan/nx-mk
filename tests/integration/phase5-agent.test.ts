/**
 * Phase 5 真链路集成（spec §5 末行 + §6.1）：真实 git 仓库 + 真实 review guard +
 * 真实 sqlite 共享库；只有 provider 是 scripted（真实 claude 不进 CI）。
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import { promisify } from 'node:util'
import { openCoverageDb } from '@nx-mk/coverage'
import {
  createApiUiAgent,
  createReviewAgent,
  runAgentLoop,
  type AgentProvider,
  type CoverageReport,
} from '../../packages/agent/src/index.js'

const execFileP = promisify(execFile)

// 每个用例的临时根目录登记（afterEach 统一清理，不留孤儿 tmp 目录）
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const SRC = `export function Card() {
  return <div className="card">placeholder</div>
}
`

// 可被真实 git apply 的 diff（对 SRC 逐字）
const GOOD_DIFF = `diff --git a/src.tsx b/src.tsx
--- a/src.tsx
+++ b/src.tsx
@@ -1,3 +1,4 @@
 export function Card() {
-  return <div className="card">placeholder</div>
+  return <div className="card" data-mk-field="GET /users.200.data.name">placeholder</div>
+  {/* field rendered */}
 }
`

// 指向不存在文件的 diff → git apply --check 必败（G1 reject 路径）
const BAD_DIFF = `diff --git a/missing.tsx b/missing.tsx
--- a/missing.tsx
+++ b/missing.tsx
@@ -1,1 +1,2 @@
-  nothing
+  nothing else
`

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

// 真实 git 仓库 + 初始提交（apply --check 的对照基线）
function makeGitProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-mk-agent-e2e-'))
  roots.push(root)
  writeFileSync(join(root, 'src.tsx'), SRC)
  git(root, ['init'])
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init'])
  return root
}

function makeReport(ignored: string[] = []): CoverageReport {
  return {
    runId: 'run_base',
    metrics: {
      requiredCoverage: 0, effectiveCoverage: 0, rawBackendFieldCoverage: 0,
      endpointsTotal: 1, endpointsCalled: 1, fieldsTotal: 1, fieldsReturned: 1,
      requiredFields: 1, missingRequiredFields: 1,
      ignoredReturnedFields: ignored.length, suspiciousFields: 0,
    },
    missingRequiredFields: [
      { fieldId: 'GET /users.200.data.name', fieldPath: 'data.name', endpointId: 'getUsers', state: 'missing', policyStatus: 'required' },
    ],
    weakEvidenceFields: [],
    ignoredReturnedFields: ignored.map((id) => ({ fieldId: id, fieldPath: id, state: 'ignored' as const, policyStatus: 'ignored' as const })),
    suspiciousCoverage: [],
    endpoints: [{ endpointId: 'getUsers', method: 'GET', path: '/users', called: true, fieldsTotal: 1, fieldsCovered: 0 }],
    requests: [],
  }
}

function providerReturning(diffText: string): AgentProvider {
  return { name: 'fake', edit: async () => ({ diffText }) }
}

async function gitApplyCheckReal(cwd: string, patchPath: string): Promise<boolean> {
  try {
    await execFileP('git', ['apply', '--check', patchPath], { cwd })
    return true
  } catch {
    return false
  }
}

describe('Phase 5 integration — real git + real guard', () => {
  it('produces an applicable patch (G1 pass) and records agent_iterations in the shared db', async () => {
    const root = makeGitProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(), config: {} },
      { provider: providerReturning(GOOD_DIFF), apiUiAgent: createApiUiAgent(), reviewAgent: createReviewAgent() },
    )
    expect(summary.produced).toBe(1)
    expect(summary.stoppedBy).toBe('backlog-empty')
    const patch = join(root, summary.patchDir, 'iter-1-GET_/users.200.data.name.patch')
    // 真实 git 认可这个 patch 可应用
    expect(await gitApplyCheckReal(root, patch)).toBe(true)
    // 共享库（.nx-mk/coverage.db）两表落行
    const db = openCoverageDb(join(root, '.nx-mk', 'coverage.db'))
    const iters = db.prepare('SELECT * FROM agent_iterations').all() as Record<string, unknown>[]
    const runs = db.prepare('SELECT * FROM runs WHERE id = ?').all(summary.agentRunId) as Record<string, unknown>[]
    db.close()
    expect(iters).toHaveLength(1)
    expect(iters[0]?.status).toBe('produced')
    expect(iters[0]?.after_coverage).toBeNull()
    expect(runs[0]?.status).toBe('completed')
    // R4：空 run 目录存在（dashboard 目录扫描可见）+ 产物只落在 .nx-mk/ 下（D1 铁律）
    expect(existsSync(join(root, '.nx-mk', 'runs', summary.agentRunId))).toBe(true)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toContain('?? .nx-mk/')
  })

  it('archives a non-applicable diff under rejected/ (G1 reject, E7)', async () => {
    const root = makeGitProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(), config: {} },
      { provider: providerReturning(BAD_DIFF), apiUiAgent: createApiUiAgent(), reviewAgent: createReviewAgent() },
    )
    expect(summary.produced).toBe(0)
    expect(summary.rejected).toBe(1)
    expect(summary.givenUp).toBe(1)
    const rejectedDir = join(root, '.nx-mk', 'patches', summary.agentRunId, 'rejected')
    expect(readdirSync(rejectedDir)).toHaveLength(2)
  })

  it('rejects an applicable diff that renders an ignored field (G2, D3)', async () => {
    const root = makeGitProject()
    const ignoredDiff = GOOD_DIFF.replace('data.name', 'data.internalRiskScore')
    const summary = await runAgentLoop(
      // EXEC-7：ignored 集合须与 data-mk-field 标记值同命名空间（完整 fieldId，G2 整串比对）
      { projectRoot: root, report: makeReport(['GET /users.200.data.internalRiskScore']), config: {} },
      { provider: providerReturning(ignoredDiff), apiUiAgent: createApiUiAgent(), reviewAgent: createReviewAgent() },
    )
    expect(summary.produced).toBe(0)
    expect(summary.givenUp).toBe(1)
    const db = openCoverageDb(join(root, '.nx-mk', 'coverage.db'))
    const iters = db.prepare('SELECT status, summary FROM agent_iterations').all() as { status: string; summary: string }[]
    db.close()
    expect(iters.some((r) => r.summary.includes('ignored-render'))).toBe(true)
  })

  it('skips G1 on a non-git project and still produces (R10)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nx-mk-agent-nogit-'))
    roots.push(root)
    writeFileSync(join(root, 'src.tsx'), SRC)
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(), config: {} },
      { provider: providerReturning(GOOD_DIFF), apiUiAgent: createApiUiAgent(), reviewAgent: createReviewAgent() },
    )
    expect(summary.produced).toBe(1) // verdict 仅由 G2-G4 决定
  })
})
