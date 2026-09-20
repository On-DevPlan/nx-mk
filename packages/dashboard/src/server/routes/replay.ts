/**
 * POST /api/runs/:runId/replay/request/:requestId、GET /api/runs/:runId/replays（spec §2.3）。
 * trace 来源同 requests.ts 详情路由：db 行优先 → report 摘要回落（同源防御路径）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { RouteContext } from '../types.js'
import { reportForRun } from '../store/report-reader.js'
import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
import { Queries } from '../store/queries.js'
import { classifyReplay, performReplay, makeReplayId, writeReplayTrail, listReplays } from '../replay.js'
import type { ReplayResponse, ReplaysListResponse } from '../../shared/api-types.js'

function busy503(reply: FastifyReply): { handled: true } {
  void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
  return { handled: true }
}

export function registerReplayRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const readerOpts = { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS }

  app.post('/api/runs/:runId/replay/request/:requestId', async (req, reply) => {
    const { runId, requestId } = req.params as { runId: string; requestId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    // trace 解析（db 行优先 → report 回落）——只需 method/url
    let method: string | undefined
    let url: string | undefined
    try {
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
      try {
        const trace = reader ? new Queries(reader).getTrace(runId, requestId) : undefined
        if (trace) {
          method = trace.method
          url = trace.url
        }
      } finally {
        reader?.close()
      }
    } catch (err) {
      if (err instanceof DbBusyError) return busy503(reply)
      throw err
    }
    if (!method || !url) {
      const summary = reportForRun(ctx.nxMkDir, runId)?.requests.find((r) => r.requestId === requestId)
      if (!summary) return reply.code(404).send({ error: `unknown request: ${requestId}` })
      method = summary.method ?? 'GET'
      url = summary.url ?? ''
    }
    // R1：服务端分类；E1 blocked → 403
    const cls = classifyReplay(method, url)
    if (cls.verdict === 'blocked') {
      return reply.code(403).send({ error: `replay blocked: ${cls.reason}`, verdict: cls.verdict })
    }
    // V4：idempotent 与 unsafe 同门 —— safe 跳过 confirm 门；idempotent/unsafe 无 confirm → 409（E2）
    const body = (req.body ?? {}) as { confirm?: boolean }
    if (cls.verdict !== 'safe' && body.confirm !== true) {
      return reply.code(409).send({ error: 'unsafe method requires confirmation', verdict: cls.verdict })
    }
    // V3：PUT 复刻生成幂等键；其余无附加头
    const key = cls.verdict === 'idempotent' ? `replay-${runId}-${requestId}-${Date.now()}` : null
    const outcome = await performReplay(method, url, key)
    const replayId = makeReplayId(requestId)
    const writtenId = writeReplayTrail(ctx.nxMkDir, {
      replayId,
      runId,
      requestId,
      verdict: cls.verdict,
      reason: cls.reason,
      createdAt: new Date().toISOString(),
      // V3：request_traces 没有 body 列，留痕 reqBody 一律记空串
      request: { method, url, headers: key ? { 'idempotency-key': key } : {}, reqBody: '' },
      response: {
        ok: outcome.ok,
        status: outcome.status,
        durationMs: outcome.durationMs,
        bodyPreview: outcome.bodyPreview,
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      },
    })
    const res: ReplayResponse = {
      replayId: writtenId,
      verdict: cls.verdict,
      reason: cls.reason,
      ok: outcome.ok,
      status: outcome.status,
      durationMs: outcome.durationMs,
      bodyPreview: outcome.bodyPreview,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    }
    return res
  })

  app.get('/api/runs/:runId/replays', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    const res: ReplaysListResponse = { replays: listReplays(ctx.nxMkDir, runId) }
    return res
  })
}