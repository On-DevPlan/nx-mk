/**
 * Goal Loop 类型与覆盖率计算测试 (M14)
 *
 * 验证：
 * - Coverage 类型与计算
 * - GoalConfig 默认值
 * - computeCoverage 聚合 reports 并过滤 missing
 * - runGoalLoop 终止条件
 */
import { describe, it, expect } from 'vitest'
import { computeCoverage, runGoalLoop } from '../goal-loop'
import type { Coverage, GoalConfig, PluginReport, PluginSignal, MissingItem } from '../types'
import { EventBus } from '../event-bus'
import type { PluginContext } from '../plugin'
import type { Plugin } from '../plugin'

function makeReport(kind: ReportKind): PluginReport {
  switch (kind) {
    case 'endpoint-called':
      return { kind: 'endpoint-called', method: 'GET', path: '/users', turn: 1 }
    case 'route-visited':
      return { kind: 'route-visited', route: '/home', turn: 1 }
    case 'field-hit':
      return { kind: 'field-hit', fieldId: 'f1', count: 3, turn: 1 }
    case 'no-data':
      return { kind: 'no-data', reason: 'no traffic', turn: 1 }
    case 'analysis':
      return { kind: 'analysis', missing: [], recommendations: [], turn: 1 }
  }
}
type ReportKind = 'endpoint-called' | 'route-visited' | 'field-hit' | 'no-data' | 'analysis'

function makeInitialCoverage(): Coverage {
  return {
    total: 10,
    covered: 0,
    ratio: 0,
    missing: [
      { kind: 'endpoint', method: 'GET', path: '/users' },
      { kind: 'endpoint', method: 'POST', path: '/users' },
      { kind: 'route', route: '/home' },
      { kind: 'route', route: '/about' },
      { kind: 'field', fieldId: 'f1' },
      { kind: 'field', fieldId: 'f2' },
      { kind: 'field', fieldId: 'f3' },
      { kind: 'field', fieldId: 'f4' },
      { kind: 'field', fieldId: 'f5' },
      { kind: 'field', fieldId: 'f6' },
    ],
  }
}

describe('M14: computeCoverage', () => {
  it('marks covered items as not missing', () => {
    const initial = makeInitialCoverage()
    const reports: PluginReport[] = [
      makeReport('endpoint-called'), // covers GET /users
      makeReport('route-visited'),   // covers /home
      makeReport('field-hit'),        // covers f1
    ]
    const result = computeCoverage(reports, initial)
    expect(result.total).toBe(10)
    expect(result.covered).toBe(3)
    expect(result.ratio).toBeCloseTo(0.3)
    expect(result.missing.length).toBe(7)
    // GET /users should not be in missing anymore
    expect(
      result.missing.find((m: MissingItem) => m.kind === 'endpoint' && m.method === 'GET' && m.path === '/users'),
    ).toBeUndefined()
  })

  it('reaches 100% coverage when all items reported', () => {
    const initial = makeInitialCoverage()
    const reports: PluginReport[] = []
    for (let i = 0; i < 2; i++) {
      reports.push({ kind: 'endpoint-called', method: 'GET', path: '/users', turn: 1 })
      reports.push({ kind: 'endpoint-called', method: 'POST', path: '/users', turn: 1 })
    }
    reports.push({ kind: 'route-visited', route: '/home', turn: 1 })
    reports.push({ kind: 'route-visited', route: '/about', turn: 1 })
    for (const fid of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']) {
      reports.push({ kind: 'field-hit', fieldId: fid, count: 1, turn: 1 })
    }
    const result = computeCoverage(reports, initial)
    expect(result.covered).toBe(10)
    expect(result.ratio).toBe(1.0)
    expect(result.missing.length).toBe(0)
  })

  it('keeps full coverage on 0 reports', () => {
    const initial = makeInitialCoverage()
    const result = computeCoverage([], initial)
    expect(result.covered).toBe(0)
    expect(result.missing.length).toBe(10)
  })
})

describe('M14: runGoalLoop termination', () => {
  function makeCtx(events: EventBus, plugins: Plugin[]): PluginContext {
    return {
      config: {} as any,
      logger: {} as any,
      events,
      kernel: {} as any,
      cwd: '/tmp',
      signal: undefined,
      emitReport: () => {},
      emitSignal: () => {},
      getTurn: () => 0,
      getCoverage: () => ({ total: 0, covered: 0, ratio: 0, missing: [] }),
    }
  }

  it('returns goal:met when initial coverage is 100%', async () => {
    const events = new EventBus()
    const initial: Coverage = {
      total: 5,
      covered: 5,
      ratio: 1.0,
      missing: [],
    }
    const signals: PluginSignal[] = []
    const result = await runGoalLoop({
      plugins: [],
      goal: { targetRatio: 1.0, maxTurns: 10, idleTurnsLimit: 3, absoluteTimeoutMs: 30000 },
      initialCoverage: initial,
      getReports: () => [],
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(events, []),
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('met')
    expect(result.coverage.ratio).toBe(1.0)
    expect(result.turns).toBe(0)
  })

  it('terminates with idle when no progress for N turns', async () => {
    const events = new EventBus()
    const initial = makeInitialCoverage()  // 0% covered
    // 模拟不产出任何 report 的插件（idle 状态）
    const idlePlugin: Plugin = {
      name: '@nx-mk/idle',
      version: '1.0.0',
      hooks: {},
    }
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 100,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    const signals: PluginSignal[] = []
    const result = await runGoalLoop({
      plugins: [idlePlugin],
      goal,
      initialCoverage: initial,
      getReports: () => [],
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(events, [idlePlugin]),
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('unmet')
    expect(result.terminatedBy).toBe('idle')
  })

  it('respects maxTurns bound', async () => {
    const events = new EventBus()
    const initial = makeInitialCoverage()
    const idlePlugin: Plugin = {
      name: '@nx-mk/stuck',
      version: '1.0.0',
      hooks: {},
    }
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 3,
      idleTurnsLimit: 100,  // 长 idle 容差，确保被 maxTurns 截断
      absoluteTimeoutMs: 60000,
    }
    const signals: PluginSignal[] = []
    const result = await runGoalLoop({
      plugins: [idlePlugin],
      goal,
      initialCoverage: initial,
      getReports: () => [],
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(events, [idlePlugin]),
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('unmet')
    expect(result.terminatedBy).toBe('max-turns')
    expect(result.turns).toBeLessThanOrEqual(3)
  })

  it('reads reports via getReports() — coverage advances when reports arrive', async () => {
    // M14 收尾验证：runGoalLoop 通过 getReports 访问器读到 emitReport 推入的 reports。
    // 模拟场景：插件一次性 emit 全部 field-hit 报告，Goal Loop 应在 turn 1 后 100% 覆盖。
    const events = new EventBus()
    const initial = makeInitialCoverage()  // 10 个 missing items
    const reports: PluginReport[] = [
      { kind: 'endpoint-called', method: 'GET', path: '/users', turn: 1 },
      { kind: 'endpoint-called', method: 'POST', path: '/users', turn: 1 },
      { kind: 'route-visited', route: '/home', turn: 1 },
      { kind: 'route-visited', route: '/about', turn: 1 },
      ...(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const).map((id) => ({
        kind: 'field-hit' as const,
        fieldId: id,
        count: 1,
        turn: 1,
      })),
    ]
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 5,
      idleTurnsLimit: 2,
      absoluteTimeoutMs: 60000,
    }
    const signals: PluginSignal[] = []
    const result = await runGoalLoop({
      plugins: [],
      goal,
      initialCoverage: initial,
      getReports: () => reports,
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(events, []),
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('met')
    expect(result.coverage.ratio).toBe(1.0)
    expect(result.turns).toBe(1)
  })

  it('onTurn callback is invoked with current turn number', async () => {
    // M14 收尾验证：plugins 通过 getTurn() 读 loopState.turn，kernel 通过 onTurn 回写
    const events = new EventBus()
    const initial = makeInitialCoverage()
    const turnsSeen: number[] = []
    const goal: GoalConfig = {
      targetRatio: 1.0,
      maxTurns: 3,
      idleTurnsLimit: 100,
      absoluteTimeoutMs: 60000,
    }
    const signals: PluginSignal[] = []
    await runGoalLoop({
      plugins: [],
      goal,
      initialCoverage: initial,
      getReports: () => [],
      getSignals: () => signals,
      onTurn: (t) => { turnsSeen.push(t) },
      ctx: makeCtx(events, []),
      signal: new AbortController().signal,
    })
    expect(turnsSeen).toEqual([1, 2, 3])
  })
})
describe('M14 v1.1: signal-driven termination (all-done / all-failed)', () => {
  function makeCtx(events: EventBus): PluginContext {
    return {
      config: {} as any,
      logger: {} as any,
      events,
      kernel: {} as any,
      cwd: '/tmp',
      signal: undefined,
      emitReport: () => {},
      emitSignal: () => {},
      getTurn: () => 0,
      getCoverage: () => ({ total: 0, covered: 0, ratio: 0, missing: [] }),
    }
  }
  const goal: GoalConfig = {
    targetRatio: 1.0,
    maxTurns: 100,
    idleTurnsLimit: 100,
    absoluteTimeoutMs: 60000,
  }

  it('一参与者 done 一参与者 failed → 每参与者皆终态且 ≥1 done → all-done', async () => {
    const signals: PluginSignal[] = [
      { kind: 'done', reason: 'all-collected', turn: 1, plugin: 'p-done' },
      { kind: 'failed', error: { code: 'X', message: 'boom' }, turn: 1, plugin: 'p-fail' },
    ]
    const result = await runGoalLoop({
      plugins: [],
      goal,
      initialCoverage: makeInitialCoverage(),
      getReports: () => [],
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(new EventBus()),
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('unmet')
    expect(result.terminatedBy).toBe('all-done')
  })

  it('全部参与者 failed → all-failed', async () => {
    const signals: PluginSignal[] = [
      { kind: 'failed', error: { code: 'X', message: 'a' }, turn: 1, plugin: 'p1' },
      { kind: 'failed', error: { code: 'X', message: 'b' }, turn: 1, plugin: 'p2' },
    ]
    const result = await runGoalLoop({
      plugins: [],
      goal,
      initialCoverage: makeInitialCoverage(),
      getReports: () => [],
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(new EventBus()),
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('unmet')
    expect(result.terminatedBy).toBe('all-failed')
  })

  it('沉默插件不阻塞 all-done（participating 只统计发过信号的插件）', async () => {
    // plugin-swagger 类沉默插件在列 —— 不发信号即不参与判定
    const silent: Plugin = { name: '@nx-mk/silent', version: '1.0.0', hooks: {} }
    const signals: PluginSignal[] = [
      { kind: 'done', reason: 'all-collected', turn: 1, plugin: '@nx-mk/collector' },
    ]
    const result = await runGoalLoop({
      plugins: [silent],
      goal,
      initialCoverage: makeInitialCoverage(),
      getReports: () => [],
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(new EventBus()),
      signal: new AbortController().signal,
    })
    expect(result.terminatedBy).toBe('all-done')
  })

  it('优先序锁：ratio 达标 + done 信号并存 → 仍 goal-met（goal-met 高于 all-done）', async () => {
    const initial = makeInitialCoverage()
    const reports: PluginReport[] = [
      { kind: 'endpoint-called', method: 'GET', path: '/users', turn: 1 },
      { kind: 'endpoint-called', method: 'POST', path: '/users', turn: 1 },
      { kind: 'route-visited', route: '/home', turn: 1 },
      { kind: 'route-visited', route: '/about', turn: 1 },
      ...(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const).map((id) => ({
        kind: 'field-hit' as const,
        fieldId: id,
        count: 1,
        turn: 1,
      })),
    ]
    const signals: PluginSignal[] = [
      { kind: 'done', reason: 'all-collected', turn: 1, plugin: 'p' },
    ]
    const result = await runGoalLoop({
      plugins: [],
      goal,
      initialCoverage: initial,
      getReports: () => reports,
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(new EventBus()),
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('met')
    expect(result.terminatedBy).toBe('goal-met')
  })

  it('idle 信号不算终态：done + idle-only 参与者 → 不触发 all-done，落入 idle 终止', async () => {
    const signals: PluginSignal[] = [
      { kind: 'done', reason: 'all-collected', turn: 1, plugin: 'p1' },
      { kind: 'idle', turn: 1, plugin: 'p2' },
    ]
    const result = await runGoalLoop({
      plugins: [],
      goal: { ...goal, idleTurnsLimit: 2 },
      initialCoverage: makeInitialCoverage(),
      getReports: () => [],
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(new EventBus()),
      signal: new AbortController().signal,
    })
    expect(result.terminatedBy).toBe('idle')
  })

  it('无归因信号（测试直调 ctx）落单匿名参与者桶 → 仍可 all-done', async () => {
    const signals: PluginSignal[] = [{ kind: 'done', reason: 'all-collected', turn: 1 }]
    const result = await runGoalLoop({
      plugins: [],
      goal,
      initialCoverage: makeInitialCoverage(),
      getReports: () => [],
      getSignals: () => signals,
      onTurn: () => {},
      ctx: makeCtx(new EventBus()),
      signal: new AbortController().signal,
    })
    expect(result.terminatedBy).toBe('all-done')
  })
})
