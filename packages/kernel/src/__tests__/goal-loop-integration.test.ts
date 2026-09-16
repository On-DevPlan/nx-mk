/**
 * Kernel ↔ Goal Loop 集成测试 (M14 集成 + 收尾)
 *
 * 验证：
 * - config.goal 存在时，kernel.run() 触发 Goal Loop
 * - Goal Loop 通过 getReports 访问器读取插件 emitReport（M14 收尾）
 * - 目标达成时 result.kind === 'met'（plugin emitReport 推动覆盖率）
 * - 目标未达成时 result.kind === 'unmet'（默认 idle 终止）
 * - goal:met / goal:unmet 事件被发出
 * - state.collectionResult 被填充
 * - 旧插件（无 goal config）继续走 push-based beforeRun/afterRun
 *
 * M14 收尾新增：
 * - 真实 manifest 路径：写 .nx-mk/manifest.json → kernel 据此构造 initial coverage
 * - placeholder 路径：未生成 manifest 时回退 placeholder（demo 模式）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKernel } from '../kernel'
import type { Plugin } from '../plugin'
import type { GoalConfig } from '../types'

let workDir: string
let configPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-goal-integration-'))
  configPath = join(workDir, 'nx-mk.config.yml')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function writeConfigWithGoal(goal: GoalConfig | null, openapiPath?: string): void {
  const openapiLine = openapiPath ? `openapi: '${openapiPath}'\n` : ''
  const goalYaml = goal
    ? `goal:\n  targetRatio: ${goal.targetRatio}\n  maxTurns: ${goal.maxTurns}\n  idleTurnsLimit: ${goal.idleTurnsLimit}\n  absoluteTimeoutMs: ${goal.absoluteTimeoutMs}\n`
    : ''
  writeFileSync(
    configPath,
    `plugins: []\nlogLevel: info\noutputDir: ./.nx-mk/runs\n${openapiLine}${goalYaml}`,
  )
}

function readEvents(runId: string): Array<Record<string, unknown>> {
  const eventsPath = join(workDir, '.nx-mk', 'runs', runId, 'events.jsonl')
  const content = readFileSync(eventsPath, 'utf8')
  return content.trim().split('\n').map((l) => JSON.parse(l))
}

describe('M14 integration: kernel.run() with goal loop', () => {
  it('uses goal loop when config.goal is defined', async () => {
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 5,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    writeConfigWithGoal(goal)

    const reportingPlugin: Plugin = {
      name: '@nx-mk/reporter',
      version: '1.0.0',
      hooks: {
        afterRun(ctx) {
          // 立即上报：让 Goal Loop 看到覆盖率上升
          ctx.emitReport({
            kind: 'endpoint-called',
            method: 'GET',
            path: '/test',
            turn: ctx.getTurn(),
          })
        },
      },
    }

    const kernel = createKernel({
      configPath,
      runId: 'goal-1' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [reportingPlugin],
    })
    await kernel.run()

    const state = kernel.getState()
    expect(state.collectionResult).toBeDefined()
    // plugin emitReport 在 afterRun 触发（Goal Loop 已结束），所以 result 是 unmet
    // —— 验证 collectionResult 已填充 + 终止原因合理即可
    expect(state.collectionResult?.kind).toBe('unmet')
  })

  it('C1（Task 6 审查）：beforeRun 期 emitReport 的报告进入 Goal Loop → 第一轮即 goal-met', async () => {
    // 场景（spec §1.4.2）：manifest 1 个字段；plugin-playwright 式插件在 beforeRun
    // 完成一次收集后直报 field-hit —— Goal Loop 必须消费到该报告并提前判定 met，
    // 而非把 beforeRun 的报告清空后空转到 idle 终止。
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 5,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    writeConfigWithGoal(goal)
    // 1-field manifest：Goal Loop 以 total=1 / missing=[f1] 启动
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    writeFileSync(
      join(workDir, '.nx-mk', 'manifest.json'),
      JSON.stringify({ fields: [{ id: 'f1' }] }),
    )

    const scanningPlugin: Plugin = {
      name: '@nx-mk/before-run-scanner',
      version: '1.0.0',
      hooks: {
        beforeRun(ctx) {
          // 模拟 plugin-playwright 的 beforeRun 单次收集通路：扫到 f1 → 直报 field-hit
          ctx.emitReport({ kind: 'field-hit', fieldId: 'f1', count: 1, turn: ctx.getTurn() })
        },
      },
    }

    const kernel = createKernel({
      configPath,
      runId: 'goal-c1' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [scanningPlugin],
    })
    await kernel.run()

    const state = kernel.getState()
    // 断言核心：报告未被清空 → 第 1 轮覆盖率即 100% → met（而非 unmet:idle）
    expect(state.collectionResult?.kind).toBe('met')
    expect(state.collectionResult?.terminatedBy).toBe('goal-met')
    expect(state.collectionResult?.coverage.ratio).toBe(1)
    expect(state.collectionResult?.turns).toBe(1)
  })

  it('seeds initial coverage from .nx-mk/manifest.json when present', async () => {
    // M14 收尾：写一份模拟 manifest.json，验证 kernel 把它转成 missing items
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 5,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    writeConfigWithGoal(goal)
    // 写一份 3-field 的 manifest；Goal Loop 应以 total=3 启动
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    writeFileSync(
      join(workDir, '.nx-mk', 'manifest.json'),
      JSON.stringify({ fields: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }] }),
    )

    const idlePlugin: Plugin = {
      name: '@nx-mk/idle',
      version: '1.0.0',
      hooks: {},
    }
    const kernel = createKernel({
      configPath,
      runId: 'goal-manifest' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [idlePlugin],
    })
    await kernel.run()

    const state = kernel.getState()
    // total 应来自 manifest (3)，不是 placeholder (1)
    expect(state.collectionResult?.coverage.total).toBe(3)
    // 未注入任何 report → 仍 unmet: idle
    expect(state.collectionResult?.kind).toBe('unmet')
    expect(state.collectionResult?.terminatedBy).toBe('idle')
  })

  it('falls back to placeholder when .nx-mk/manifest.json missing', async () => {
    // 不写 manifest.json → kernel 应回退 placeholder (total=1)
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 5,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    writeConfigWithGoal(goal)

    const idlePlugin: Plugin = {
      name: '@nx-mk/idle',
      version: '1.0.0',
      hooks: {},
    }
    const kernel = createKernel({
      configPath,
      runId: 'goal-no-manifest' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [idlePlugin],
    })
    await kernel.run()

    const state = kernel.getState()
    // placeholder 路径：total=1，missing 里只有 __placeholder__
    expect(state.collectionResult?.coverage.total).toBe(1)
    expect(state.collectionResult?.coverage.missing[0]).toEqual({
      kind: 'field',
      fieldId: '__placeholder__',
    })
  })

  it('emits turn:start / turn:end / goal:met events', async () => {
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 3,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    writeConfigWithGoal(goal)

    const idlePlugin: Plugin = {
      name: '@nx-mk/idle',
      version: '1.0.0',
      hooks: {},
    }
    const kernel = createKernel({
      configPath,
      runId: 'goal-2' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [idlePlugin],
    })
    await kernel.run()

    const events = readEvents('goal-2')
    const turnStarts = events.filter((e) => e.type === 'turn:start')
    const turnEnds = events.filter((e) => e.type === 'turn:end')
    const goalEvents = events.filter(
      (e) => e.type === 'goal:met' || e.type === 'goal:unmet',
    )
    expect(turnStarts.length).toBeGreaterThan(0)
    expect(turnEnds.length).toBeGreaterThan(0)
    expect(goalEvents.length).toBe(1)  // 恰好一个终止事件
  })

  it('preserves backward compat: no goal → uses beforeRun/afterRun', async () => {
    writeConfigWithGoal(null)  // 没有 goal

    const calls: string[] = []
    const legacyPlugin: Plugin = {
      name: '@nx-mk/legacy',
      version: '1.0.0',
      hooks: {
        beforeRun: () => calls.push('before'),
        afterRun: () => calls.push('after'),
      },
    }
    const kernel = createKernel({
      configPath,
      runId: 'goal-3' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [legacyPlugin],
    })
    await kernel.run()

    // push-based 路径仍然工作
    expect(calls).toEqual(['before', 'after'])
    const state = kernel.getState()
    // 没有 goal config → 不应有 collectionResult
    expect(state.collectionResult).toBeUndefined()
  })
})