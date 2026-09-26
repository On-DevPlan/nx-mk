/**
 * 流水线逐步报告（Pipeline 页）路由测试：
 * GET /api/runs/:runId/pipeline（events.jsonl 聚合 + manifest 投影 + D12 报告门控 + 404）
 * GET /api/scenarios/trails（replays 扫描 + 形状门控 + 倒序）。
 * PipelinePage 渲染（错误态/加载态/数据态）用 renderToString 直测。
 */
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { buildServer } from '../server/index.js'
import { makeNxMkDir, reportFixture, writeReportFile } from './fixtures.js'
import type { PipelineEventsResponse, PipelineReportResponse, ScenarioTrailDetailResponse, ScenarioTrailsResponse } from '../shared/api-types.js'

/** 最小可读 events.jsonl：两阶段 + 插件 + 一轮 + goal:met + 场景 start/done */
const EVENTS = [
  { type: 'phase:start', phase: 'loadConfig', timestamp: '2026-09-25T16:03:52.736Z' },
  { type: 'phase:end', phase: 'loadConfig', durationMs: 7 },
  { type: 'phase:start', phase: 'run', timestamp: '2026-09-25T16:03:52.901Z' },
  { type: 'plugin:loaded', name: '@nx-mk/plugin-swagger', version: '0.1.0' },
  { type: 'plugin:state-change', name: '@nx-mk/plugin-swagger', from: 'pending', to: 'active' },
  { type: 'scenario:start', scenarioId: 's-ok', timestamp: '2026-09-25T16:03:53.996Z' },
  { type: 'scenario:done', scenarioId: 's-ok', ok: true },
  { type: 'turn:start', turn: 1, idleTurns: 0 },
  { type: 'turn:end', turn: 1, coverage: { total: 8, covered: 8, ratio: 1 }, progress: 'improved' },
  { type: 'goal:met', coverage: { total: 8, covered: 8, ratio: 1 }, turns: 1, durationMs: 1 },
  { type: 'phase:end', phase: 'run', durationMs: 3748 },
  '{broken json',
  { notAnEvent: true },
].map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n')

const RUN_MANIFEST = JSON.stringify({
  version: '1', source: { type: 'openapi', input: 'x', hash: 'h' },
  generatedAt: 't', schemas: {}, endpoints: [{ id: 'a' }], fields: [{ id: 'f' }],
})

function setupRunWithEvents(): string {
  const nx = makeNxMkDir([{ runId: 'run_a' }])
  writeFileSync(join(nx, 'runs', 'run_a', 'events.jsonl'), EVENTS, 'utf8')
  writeFileSync(join(nx, 'runs', 'run_a', 'manifest.json'), RUN_MANIFEST, 'utf8')
  return nx
}

describe('GET /api/runs/:runId/pipeline', () => {
  it('404 for unknown run', async () => {
    const nx = setupRunWithEvents()
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_x/pipeline' })
    expect(res.statusCode).toBe(404)
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })

  it('aggregates phases/turns/goal/plugins/scenarios/manifest/analysis', async () => {
    const nx = setupRunWithEvents()
    writeReportFile(nx, reportFixture('run_a'))
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/pipeline' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as PipelineReportResponse
    // 损坏行/非事件行被跳过，其余如实聚合
    expect(body.phases).toEqual([
      { phase: 'loadConfig', startedAt: '2026-09-25T16:03:52.736Z', durationMs: 7 },
      { phase: 'run', startedAt: '2026-09-25T16:03:52.901Z', durationMs: 3748 },
    ])
    expect(body.plugins).toEqual([{ name: '@nx-mk/plugin-swagger', version: '0.1.0', state: 'active' }])
    expect(body.turns).toEqual([{ turn: 1, ratio: 1, covered: 8, total: 8, progress: 'improved' }])
    expect(body.goal).toEqual({ status: 'met', ratio: 1, turns: 1, durationMs: 1 })
    expect(body.scenarios).toEqual([{ scenarioId: 's-ok', ok: true }])
    expect(body.manifest).toEqual({ version: '1', sourceType: 'openapi', endpoints: 1, fields: 1 })
    expect(body.analysis).toEqual({ hasReport: true, requiredCoverage: 1, effectiveCoverage: 1, rawBackendFieldCoverage: 0.36 })
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })

  it('D12: report of another run → hasReport false; empty events → phases null', async () => {
    const nx = setupRunWithEvents()
    writeReportFile(nx, reportFixture('run_other'))
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const body = (await app.inject({ method: 'GET', url: '/api/runs/run_a/pipeline' })).json() as PipelineReportResponse
    expect(body.analysis.hasReport).toBe(false)
    // run_b：events.jsonl 存在但为空 → phases null（诚实空态）
    mkdirSync(join(nx, 'runs', 'run_b'), { recursive: true })
    writeFileSync(join(nx, 'runs', 'run_b', 'events.jsonl'), '', 'utf8')
    const bodyB = (await app.inject({ method: 'GET', url: '/api/runs/run_b/pipeline' })).json() as PipelineReportResponse
    expect(bodyB.phases).toBeNull()
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })
})

describe('GET /api/scenarios/trails', () => {
  it('scans shaped trails, skips broken, sorts by createdAt desc', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    const dir = join(nx, 'replays', 'scenarios', 's-ok')
    mkdirSync(dir, { recursive: true })
    const trail = (replayId: string, createdAt: string, ok = true): string => JSON.stringify({
      replayId, scenarioId: 's-ok', ok, createdAt,
      steps: [{ stepId: 'a', type: 'goto', ok: true, durationMs: 5 }],
    })
    writeFileSync(join(dir, 't-old.json'), trail('t-old', '2026-09-25T10:00:00.000Z'))
    writeFileSync(join(dir, 't-new.json'), trail('t-new', '2026-09-26T00:00:00.000Z', false))
    writeFileSync(join(dir, 't-broken.json'), '{nope')
    writeFileSync(join(dir, 'notes.txt'), 'not a trail')
    writeFileSync(join(dir, 't-badshape.json'), JSON.stringify({ replayId: 'x' }))
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/trails' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ScenarioTrailsResponse
    expect(body.trails.map((t) => t.replayId)).toEqual(['t-new', 't-old'])
    expect(body.trails[0]).toMatchObject({ scenarioId: 's-ok', ok: false, steps: [{ stepId: 'a', ok: true }] })
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })

  it('empty replays dir → empty list (no 500)', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/trails' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as ScenarioTrailsResponse).trails).toEqual([])
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })
})

describe('GET /api/runs/:runId/pipeline/events', () => {
  it('returns raw events passthrough (broken lines skipped), 404 for unknown run', async () => {
    const nx = setupRunWithEvents()
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/pipeline/events' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as PipelineEventsResponse
    // 11 条真实事件（损坏行/无 type 行被门控剔除），载荷原样透出
    expect(body.truncated).toBe(false)
    expect(body.events).toHaveLength(11)
    expect(body.events[0]).toMatchObject({ type: 'phase:start', phase: 'loadConfig', timestamp: '2026-09-25T16:03:52.736Z' })
    expect(body.events.find((e) => e.type === 'plugin:signal')).toBeUndefined()
    const res404 = await app.inject({ method: 'GET', url: '/api/runs/run_x/pipeline/events' })
    expect(res404.statusCode).toBe(404)
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })

  it('truncates beyond 500 events with truncated=true', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    const lines = Array.from({ length: 502 }, (_, i) => JSON.stringify({ type: 'phase:start', phase: `p${i}`, timestamp: 't' }))
    writeFileSync(join(nx, 'runs', 'run_a', 'events.jsonl'), lines.join('\n'), 'utf8')
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const body = (await app.inject({ method: 'GET', url: '/api/runs/run_a/pipeline/events' })).json() as PipelineEventsResponse
    expect(body.truncated).toBe(true)
    expect(body.events).toHaveLength(500)
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })
})

describe('GET /api/scenarios/trails/:replayId', () => {
  it('merges DSL step inputs by stepIdOf; honest null without configPath', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    const { dirname } = await import('node:path')
    const dir = dirname(nx)
    const configPath = join(dir, 'nx-mk.config.yml')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'mk/scenarios'), { recursive: true })
    writeFileSync(join(dir, 'mk/scenarios/s.yml'), 'version: 1\nscenarios:\n  - id: s-ok\n    name: ok\n    steps:\n      - type: goto\n        url: /users/1\n      - type: assertFieldVisible\n        field: user.name\n', 'utf8')
    writeFileSync(configPath, 'scenarios:\n  include:\n    - "mk/scenarios/**/*.yml"\n', 'utf8')
    const trailDir = join(nx, 'replays', 'scenarios', 's-ok')
    mkdirSync(trailDir, { recursive: true })
    // DSL 步骤无显式 id → stepIdOf 缺省 s-ok-step-{i}
    writeFileSync(join(trailDir, 't1.json'), JSON.stringify({
      replayId: 't1', scenarioId: 's-ok', ok: true, createdAt: '2026-09-26T00:00:00.000Z',
      steps: [
        { stepId: 's-ok-step-0', type: 'goto', ok: true, durationMs: 5 },
        { stepId: 's-ok-step-1', type: 'assertFieldVisible', ok: true, durationMs: 6 },
      ],
    }), 'utf8')
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui'), configPath })
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/trails/t1' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ScenarioTrailDetailResponse
    expect(body.dslFile).not.toBeNull()
    expect(body.steps[0]?.input).toEqual({ url: '/users/1' })
    expect(body.steps[1]?.input).toEqual({ field: 'user.name' })
    // 无 configPath → DSL 不可得，input/dslFile 诚实 null（结果照常返回）
    const appBare = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const bare = (await appBare.inject({ method: 'GET', url: '/api/scenarios/trails/t1' })).json() as ScenarioTrailDetailResponse
    expect(bare.dslFile).toBeNull()
    expect(bare.steps.every((s) => s.input === null)).toBe(true)
    await appBare.close()
    // 未知 replayId → 404
    const res404 = await app.inject({ method: 'GET', url: '/api/scenarios/trails/nope' })
    expect(res404.statusCode).toBe(404)
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

// —— PipelinePage 渲染（node renderToString；hooks mock 同 pages.test 模式）——

const err404 = vi.hoisted(async () => {
  const { ApiError } = await import('../ui/api.js')
  return new ApiError(404, { error: 'unknown run: run_x' })
})

vi.mock('../ui/hooks', async () => {
  const error = await err404
  return {
    usePolling: <T,>() => ({ data: null as T | null, error }),
    useEventSource: () => ({ connected: false }),
  }
})

function renderPage(el: ReturnType<typeof createElement>): string {
  return renderToString(el).replace(/<!-- -->/g, '')
}

describe('PipelinePage render', () => {
  it('404 shows empty state, not stuck loading', async () => {
    const { PipelinePage } = await import('../ui/pages/Pipeline.js')
    const html = renderPage(createElement(PipelinePage, { runId: 'run_x' }))
    expect(html).toContain('Run not found: run_x')
    expect(html).not.toContain('loading…')
  })
})
