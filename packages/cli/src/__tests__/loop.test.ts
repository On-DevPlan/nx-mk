/**
 * loop 子命令接线测试（spec §3.9 / E1/E2）：注入 runLoop 替身 —— 不 spawn 真 claude。
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { KernelError } from '@nx-mk/kernel'
import { loopMain, type LoopCliDeps } from '../commands/loop.js'
import type { LoopOptions, LoopSummary } from '@nx-mk/agent'

function makeProject(opts?: { withConfig?: boolean; withReport?: boolean; reportBody?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-mk-loop-cli-'))
  if (opts?.withConfig !== false) writeFileSync(join(root, 'nx-mk.config.yml'), 'openapi: ./swagger.json\n', 'utf8')
  if (opts?.withReport !== false) {
    const nxMk = join(root, '.nx-mk')
    mkdirSync(nxMk, { recursive: true })
    writeFileSync(
      join(nxMk, 'coverage-report.json'),
      opts?.reportBody ?? JSON.stringify({ runId: 'run_base', metrics: { requiredCoverage: 0.625, effectiveCoverage: 0.625, rawBackendFieldCoverage: 0.625, missingRequiredFields: 2 } }),
    )
  }
  return root
}

function makeDeps(): { deps: LoopCliDeps; calls: LoopOptions[]; summary: LoopSummary } {
  const calls: LoopOptions[] = []
  const summary: LoopSummary = {
    agentRunId: 'agent_20260918_120000_ab12', iterations: 2, produced: 3, rejected: 1, failed: 0, givenUp: 0,
    patchDir: '.nx-mk/patches/agent_20260918_120000_ab12', stoppedBy: 'backlog-empty',
  }
  return { deps: { runLoop: async (opts) => { calls.push(opts); return summary } }, calls, summary }
}

afterEach(() => { vi.restoreAllMocks() })

describe('loopMain', () => {
  it('E2: throws CONFIG_NOT_FOUND when the config file is missing', async () => {
    const root = makeProject({ withConfig: false })
    await expect(loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps: makeDeps().deps }))
      .rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' })
  })

  it('E1: throws RUN_NOT_FOUND when coverage-report.json is missing', async () => {
    const root = makeProject({ withReport: false })
    const { deps } = makeDeps()
    await expect(loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps }))
      .rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })

  it('E1: throws RUN_NOT_FOUND on a malformed report (shape gate)', async () => {
    const root = makeProject({ reportBody: '{"nope": true}' })
    const { deps } = makeDeps()
    await expect(loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps }))
      .rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })

  it('passes report + defaults into runLoop and prints the summary', async () => {
    const root = makeProject()
    const { deps, calls, summary } = makeDeps()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.projectRoot).toBe(root)
    expect(calls[0]?.report.runId).toBe('run_base')
    expect(calls[0]?.config).toEqual({})
    expect(existsSync(join(root, '.nx-mk'))).toBe(true)
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(printed).toContain(`Agent loop completed: ${summary.agentRunId}`)
    expect(printed).toContain('produced: 3')
    expect(printed).toContain('stopped by: backlog-empty')
    expect(printed).toContain('requiredCoverage 62.5%')
    expect(printed).toContain(`next: git apply ${summary.patchDir}/*.patch && nx-mk run`)
  })

  it('--max-iterations overrides config.agent.loop.maxIterations', async () => {
    const root = makeProject()
    writeFileSync(join(root, 'nx-mk.config.yml'), 'agent:\n  loop:\n    maxIterations: 7\n', 'utf8')
    const { deps, calls } = makeDeps()
    await loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, maxIterations: 2, deps })
    expect(calls[0]?.config.loop?.maxIterations).toBe(2)
  })

  it('config.agent.loop.maxIterations passes through without CLI override', async () => {
    const root = makeProject()
    writeFileSync(join(root, 'nx-mk.config.yml'), 'agent:\n  loop:\n    maxIterations: 7\n', 'utf8')
    const { deps, calls } = makeDeps()
    await loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps })
    expect(calls[0]?.config.loop?.maxIterations).toBe(7)
  })
})
