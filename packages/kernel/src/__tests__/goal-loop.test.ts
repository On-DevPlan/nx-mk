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
import type { Coverage, GoalConfig, PluginReport, MissingItem } from '../types'
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
    const result = await runGoalLoop({
      plugins: [],
      goal: { targetRatio: 1.0, maxTurns: 10, idleTurnsLimit: 3, absoluteTimeoutMs: 30000 },
      initialCoverage: initial,
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
    const result = await runGoalLoop({
      plugins: [idlePlugin],
      goal,
      initialCoverage: initial,
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
    const result = await runGoalLoop({
      plugins: [idlePlugin],
      goal,
      initialCoverage: initial,
      ctx: makeCtx(events, [idlePlugin]),
      signal: new AbortController().signal,
    })
    expect(result.kind).toBe('unmet')
    expect(result.terminatedBy).toBe('max-turns')
    expect(result.turns).toBeLessThanOrEqual(3)
  })
})