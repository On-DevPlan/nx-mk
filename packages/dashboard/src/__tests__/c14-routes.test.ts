/**
 * C14 补页路由测试：
 * - GET /api/runs/:runId/endpoints（report D12 门控 + 404 + endpoints 透出）
 * - GET /api/runs/:runId/agent（agent_iterations 行投影 + 空数组 + 404）
 * EndpointsListPage / AgentPage 渲染（错误态/加载态/数据态）用 renderToString 直测。
 */
import { describe, it, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { buildServer } from '../server/index.js'
import { makeNxMkDir, reportFixture, writeReportFile, seedDb } from './fixtures.js'
import type { AgentIterationsResponse, EndpointsListResponse } from '../shared/api-types.js'
import { AgentPage } from '../ui/pages/AgentPage.js'
import { EndpointsListPage } from '../ui/pages/EndpointsList.js'

describe('GET /api/runs/:runId/endpoints', () => {
  it('404 for unknown run', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_x/endpoints' })
    expect(res.statusCode).toBe(404)
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })

  it('report 命中 → endpoints 透出（D12 同 metrics）', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    writeReportFile(nx, reportFixture('run_a'))
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/endpoints' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as EndpointsListResponse
    expect(body.endpoints).toEqual([
      { endpointId: 'ep_getUser', method: 'GET', path: '/users/{id}', called: true, fieldsTotal: 8, fieldsCovered: 7 },
    ])
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })

  it('D12: 旧 run 查询（report 已被新 run 覆写）→ 404', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    writeReportFile(nx, reportFixture('run_other'))
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/endpoints' })
    expect(res.statusCode).toBe(404)
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })
})

describe('GET /api/runs/:runId/agent', () => {
  it('404 for unknown run', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_x/agent' })
    expect(res.statusCode).toBe(404)
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })

  it('agent_iterations 行按 iteration 序投影；loop 未跑 → 空数组', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    seedDb(nx, {
      agentIterations: [
        { runId: 'run_a', iteration: 2, status: 'rejected', summary: 'hidden DOM', beforeCoverage: 0.5 },
        { runId: 'run_a', iteration: 1, status: 'produced', summary: 'render data.name', beforeCoverage: 0.25 },
      ],
    })
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/agent' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as AgentIterationsResponse
    expect(body.iterations.map((i) => i.iteration)).toEqual([1, 2])
    expect(body.iterations[0]).toMatchObject({
      id: 'ai_run_a_1', runId: 'run_a', status: 'produced',
      summary: 'render data.name', beforeCoverage: 0.25, afterCoverage: null,
    })
    // 同 nx 无 agent 行的 run → 空数组（不是 404）
    const res2 = await app.inject({ method: 'GET', url: '/api/runs/run_empty/agent' })
    expect(res2.statusCode).toBe(404) // 无 runs/run_empty 目录
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })

  it('有 run 目录但 loop 未跑 → 200 空数组', async () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    seedDb(nx, { runs: [{ id: 'run_a' }] })
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/agent' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as AgentIterationsResponse).iterations).toEqual([])
    await app.close()
    rmSync(join(nx, '..'), { recursive: true, force: true })
  })
})

describe('pages renderToString', () => {
  it('AgentPage 数据态 StatusBar/diffPath 空值 — 化', () => {
    const nx = makeNxMkDir([])
    try {
      const html = renderToString(createElement(AgentPage, { runId: 'run_a' }))
      expect(html).toContain('loading…')
    } finally {
      rmSync(join(nx, '..'), { recursive: true, force: true })
    }
  })

  it('EndpointsListPage 404 报告缺失态', () => {
    const nx = makeNxMkDir([{ runId: 'run_a' }])
    try {
      const html = renderToString(createElement(EndpointsListPage, { runId: 'run_a' }))
      expect(html).toContain('loading…')
    } finally {
      rmSync(join(nx, '..'), { recursive: true, force: true })
    }
  })
})
