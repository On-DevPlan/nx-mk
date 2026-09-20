/**
 * Replay Request 路由测试（Phase 4.5）：三分类矩阵 / blocked 403 / 无 confirm 409 /
 * fetch mock 复刻参数快照 / replay-error 200（R4）/ 留痕文件形状（R5）/ 留痕列表。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, rmSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { buildServer } from '../server/index.js'
import { makeNxMkDir, reportFixture, writeReportFile, seedDb } from './fixtures.js'
import { classifyReplay } from '../server/replay.js'
import type { FastifyInstance } from 'fastify'
import type { ReplayResponse, ReplaysListResponse } from '../shared/api-types.js'

describe('classifyReplay（plan §27.2 矩阵）', () => {
  it('GET/HEAD → safe', () => {
    expect(classifyReplay('GET', 'http://api.local/users/1').verdict).toBe('safe')
    expect(classifyReplay('HEAD', 'http://api.local/users/1').verdict).toBe('safe')
  })
  it('PUT → idempotent（复刻时生成 Idempotency-Key，V3）', () => {
    expect(classifyReplay('PUT', 'http://api.local/users/1').verdict).toBe('idempotent')
  })
  it('POST/PATCH/DELETE → unsafe', () => {
    expect(classifyReplay('POST', 'http://api.local/orders').verdict).toBe('unsafe')
    expect(classifyReplay('PATCH', 'http://api.local/orders/1').verdict).toBe('unsafe')
    expect(classifyReplay('DELETE', 'http://api.local/orders/1').verdict).toBe('unsafe')
  })
  it('敏感路径 → blocked（压过 method 规则）', () => {
    expect(classifyReplay('GET', 'http://api.local/payment/123').verdict).toBe('blocked')
    expect(classifyReplay('POST', 'http://api.local/x/refund').verdict).toBe('blocked')
  })
})

describe('replay 路由', () => {
  let dir: string
  let app: FastifyInstance

  beforeEach(() => {
    dir = makeNxMkDir([{ runId: 'run_b' }])
    seedDb(dir, {
      runs: [{ id: 'run_b', status: 'completed' }],
      traces: [
        { runId: 'run_b', traceId: 'req_get', method: 'GET', url: 'http://api.local/users/1', path: '/users/1', status: 200, durationMs: 12, startedAt: '2026-09-20T10:00:01.000Z' },
        { runId: 'run_b', traceId: 'req_post', method: 'POST', url: 'http://api.local/orders', path: '/orders', status: 201, durationMs: 30, startedAt: '2026-09-20T10:00:02.000Z' },
        { runId: 'run_b', traceId: 'req_pay', method: 'GET', url: 'http://api.local/payment/9', path: '/payment/9', status: 200, durationMs: 5, startedAt: '2026-09-20T10:00:03.000Z' },
        { runId: 'run_b', traceId: 'req_put', method: 'PUT', url: 'http://api.local/users/1', path: '/users/1', status: 200, durationMs: 8, startedAt: '2026-09-20T10:00:04.000Z' },
      ],
      hits: [],
      evidence: [],
      coverageFields: [],
    })
    writeReportFile(dir, reportFixture('run_b'))
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
  })
  afterEach(async () => {
    await app.close()
    vi.unstubAllGlobals()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('blocked → 403（E1）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_pay' })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { verdict: string }).verdict).toBe('blocked')
  })

  it('unsafe 无 confirm → 409（E2）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_post' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: string }).error).toBe('unsafe method requires confirmation')
  })

  it('idempotent 无 confirm → 409（V4：与 unsafe 同门）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_put' })
    expect(res.statusCode).toBe(409)
  })

  it('safe GET 直接复刻：fetch 以原 method+url 调用，200 响应（V3：无 body/无多余头）', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":1}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_get' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReplayResponse
    expect(body.verdict).toBe('safe')
    expect(body.ok).toBe(true)
    expect(body.status).toBe(200)
    expect(body.bodyPreview).toBe('{"id":1}')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('http://api.local/users/1')
    expect(calledOpts.method).toBe('GET')
  })

  it('PUT confirm 后复刻带生成的 idempotency-key（V3）', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_put', payload: { confirm: true } })
    expect(res.statusCode).toBe(200)
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['idempotency-key']).toMatch(/^replay-run_b-req_put-\d+$/)
  })

  it('网络层失败 → 200 {status:"replay-error"}（R4/E3）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_get' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReplayResponse
    expect(body.status).toBe('replay-error')
    expect(body.ok).toBe(false)
    expect(body.error).toContain('ECONNREFUSED')
  })

  it('留痕文件写入 .nx-mk/replays/<runId>/ 且形状合规（R5）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"a":1}', { status: 200 })))
    await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_get' })
    const replayDir = join(dir, 'replays', 'run_b')
    const files = readdirSync(replayDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^req_get-\d+\.json$/)
    const trail = JSON.parse(readFileSync(join(replayDir, files[0]!), 'utf8')) as Record<string, unknown>
    expect(trail.verdict).toBe('safe')
    expect((trail.request as Record<string, unknown>).method).toBe('GET')
    expect((trail.request as Record<string, unknown>).url).toBe('http://api.local/users/1')
    expect((trail.request as Record<string, unknown>).reqBody).toBe('')
    expect(((trail.response as Record<string, unknown>).bodyPreview as string).length).toBeLessThanOrEqual(500)
  })

  it('GET /api/runs/:runId/replays 返回留痕列表（新→旧）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })))
    await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/req_get' })
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_b/replays' })
    expect(res.statusCode).toBe(200)
    const list = res.json() as ReplaysListResponse
    expect(list.replays).toHaveLength(1)
    expect(list.replays[0]!.replayId).toMatch(/^req_get-\d+$/)
  })

  it('留痕列表：无留痕 → 空数组；未知 run → 404', async () => {
    const empty = await app.inject({ method: 'GET', url: '/api/runs/run_b/replays' })
    expect((empty.json() as ReplaysListResponse).replays).toEqual([])
    const missing = await app.inject({ method: 'GET', url: '/api/runs/run_x/replays' })
    expect(missing.statusCode).toBe(404)
  })

  it('未知 request → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_b/replay/request/nope' })
    expect(res.statusCode).toBe(404)
  })
})