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
import { computeCoverage } from '../goal-loop'
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

function writeConfigWithGoal(goal: GoalConfig | null, openapiPath?: string, coverageIgnored?: string[]): void {
  const openapiLine = openapiPath ? `openapi: '${openapiPath}'\n` : ''
  const goalYaml = goal
    ? `goal:\n  targetRatio: ${goal.targetRatio}\n  maxTurns: ${goal.maxTurns}\n  idleTurnsLimit: ${goal.idleTurnsLimit}\n  absoluteTimeoutMs: ${goal.absoluteTimeoutMs}\n`
    : ''
  const coverageYaml = coverageIgnored && coverageIgnored.length > 0
    ? `coverage:\n  ignored:\n${coverageIgnored.map((g) => `    - ${g}\n`).join('')}`
    : ''
  writeFileSync(
    configPath,
    `plugins: []\nlogLevel: info\noutputDir: ./.nx-mk/runs\n${openapiLine}${goalYaml}${coverageYaml}`,
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
    // （Task 3 / spec §3.1：missing 索引取 normalizedPath，id 不再进 missing）
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    writeFileSync(
      join(workDir, '.nx-mk', 'manifest.json'),
      JSON.stringify({ fields: [{ id: 'f1', normalizedPath: 'f1' }] }),
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

  it('M14 v1.1：beforeRun 期 emitSignal(done) → all-done 早停 + plugin:signal 事件带插件归因', async () => {
    // 场景：plugin-playwright 式插件完成单次收集（无字段命中）后声明 done ——
    // Goal Loop 不再烧满 maxTurns，第 1 轮即以 all-done 诚实终止。
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 5,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    writeConfigWithGoal(goal)

    const collectingPlugin: Plugin = {
      name: '@nx-mk/one-pass-collector',
      version: '1.0.0',
      hooks: {
        beforeRun(ctx) {
          ctx.emitSignal({ kind: 'done', reason: 'all-collected', turn: ctx.getTurn() })
        },
      },
    }

    const kernel = createKernel({
      configPath,
      runId: 'goal-signal' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [collectingPlugin],
    })
    await kernel.run()

    const state = kernel.getState()
    // 断言核心：done 声明 → 第 1 轮 all-done 早停（未达目标 → kind unmet）
    expect(state.collectionResult?.kind).toBe('unmet')
    expect(state.collectionResult?.terminatedBy).toBe('all-done')
    expect(state.collectionResult?.turns).toBe(1)
    // 审计链：events.jsonl 落 plugin:signal 行，signal.plugin 由 hook 运行器归因
    const signalEvents = readEvents('goal-signal').filter((e) => e.type === 'plugin:signal')
    expect(signalEvents).toHaveLength(1)
    expect(signalEvents[0]).toMatchObject({
      signal: { kind: 'done', reason: 'all-collected', plugin: '@nx-mk/one-pass-collector' },
    })
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
    // （Task 3 / spec §3.1：missing 索引取 normalizedPath）
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    writeFileSync(
      join(workDir, '.nx-mk', 'manifest.json'),
      JSON.stringify({
        fields: [
          { id: 'f1', normalizedPath: 'f1' },
          { id: 'f2', normalizedPath: 'f2' },
          { id: 'f3', normalizedPath: 'f3' },
        ],
      }),
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

  it('goal-met 后 RunResult 携带 terminatedBy 与 coverage（spec §3.1 审计链）', async () => {
    // 沿既有 C1 用例 arrange：beforeRun 期 emitReport field-hit + 1-field manifest
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 5,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    writeConfigWithGoal(goal)
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    writeFileSync(
      join(workDir, '.nx-mk', 'manifest.json'),
      JSON.stringify({ fields: [{ id: 'f1', normalizedPath: 'data.name' }] }),
    )

    const scanningPlugin: Plugin = {
      name: '@nx-mk/runresult-scanner',
      version: '1.0.0',
      hooks: {
        beforeRun(ctx) {
          ctx.emitReport({ kind: 'field-hit', fieldId: 'data.name', count: 1, turn: ctx.getTurn() })
        },
      },
    }

    const kernel = createKernel({
      configPath,
      runId: 'goal-runresult' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [scanningPlugin],
    })
    const result = await kernel.run()

    // spec §3.1 审计链：终止原因与覆盖率快照随 RunResult 返回（Task 8 的 run.ts 消费）
    expect(result.runId).toBe('goal-runresult')
    expect(result.terminatedBy).toBe('goal-met')
    // coverage 快照以 computeCoverage 口径复核：无新增 reports 时 ratio 仍为 1
    expect(result.coverage).toBeDefined()
    const recheck = computeCoverage([], result.coverage!)
    expect(recheck.ratio).toBe(1)
    expect(result.coverage?.ratio).toBe(1)
    expect(result.coverage?.total).toBe(1)
    expect(result.coverage?.missing).toEqual([])
  })

  it('config.coverage.ignored → ignored 字段不进 goal-loop missing 索引', async () => {
    // 控制方裁定并入（Task 9）：kernel.ts readInitialCoverageFromManifest 接线 config.coverage.ignored ——
    // 命中 glob 的字段不进 loopState.coverage.missing（goal 侧 policy 联动）。
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 5,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    writeConfigWithGoal(goal, undefined, ['data.internalRiskScore'])
    // 2-field manifest：data.name（required）+ data.internalRiskScore（required，但 ignored）
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    writeFileSync(
      join(workDir, '.nx-mk', 'manifest.json'),
      JSON.stringify({
        fields: [
          { id: 'f1', normalizedPath: 'data.name' },
          { id: 'f2', normalizedPath: 'data.internalRiskScore' },
        ],
      }),
    )

    const scanningPlugin: Plugin = {
      name: '@nx-mk/scanner',
      version: '1.0.0',
      hooks: {
        beforeRun(ctx) {
          ctx.emitReport({ kind: 'field-hit', fieldId: 'data.name', count: 1, turn: ctx.getTurn() })
        },
      },
    }

    const kernel = createKernel({
      configPath,
      runId: 'goal-coverage-ignored' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [scanningPlugin],
    })
    const result = await kernel.run()
    const state = kernel.getState()

    // ignored 字段排除后 total = 1（仅 data.name）；data.name 命中 → goal-met
    expect(state.collectionResult?.coverage.total).toBe(1)
    expect(state.collectionResult?.coverage.missing).toEqual([])
    expect(result.terminatedBy).toBe('goal-met')
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