/**
 * GET /api/runs/:runId/requests、…/:requestId（spec §3.5）。
 * 列表：report 命中 → report.requests；否则 request_traces 投影回落（旧 run）。
 * 详情：db trace 行优先；db 无行时回落 report 摘要拼装（同源数据的防御路径）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { RouteContext } from '../types.js'
import { reportForRun } from '../store/report-reader.js'
import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
import { Queries } from '../store/queries.js'
import type { TraceRow, RequestsListResponse, RequestDetailResponse } from '../../shared/api-types.js'
import type { RequestTraceSummary } from '@nx-mk/coverage'

function busy503(reply: FastifyReply): { handled: true } {
  void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
  return { handled: true }
}

export function registerRequestRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const readerOpts = { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS }

  app.get('/api/runs/:runId/requests', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    const report = reportForRun(ctx.nxMkDir, runId)
    if (report) return { requests: report.requests } satisfies RequestsListResponse
    try {
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
      try {
        if (!reader) return { requests: [] } satisfies RequestsListResponse
        const requests: RequestTraceSummary[] = new Queries(reader).listTraces(runId).map((t) => ({
          requestId: t.traceId,
          ...(t.endpointId != null ? { endpointId: t.endpointId } : {}),
          method: t.method,
          url: t.url,
          ...(t.path != null ? { path: t.path } : {}),
          ...(t.status != null ? { status: t.status } : {}),
          ...(t.durationMs != null ? { durationMs: t.durationMs } : {}),
          ...(t.startedAt != null ? { startedAt: t.startedAt } : {}),
          ...(t.endedAt != null ? { endedAt: t.endedAt } : {}),
        }))
        return { requests } satisfies RequestsListResponse
      } finally {
        reader?.close()
      }
    } catch (err) {
      if (err instanceof DbBusyError) return busy503(reply)
      throw err
    }
  })

  app.get('/api/runs/:runId/requests/:requestId', async (req, reply) => {
    const { runId, requestId } = req.params as { runId: string; requestId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    try {
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
      try {
        const queries = reader ? new Queries(reader) : null
        let trace: TraceRow | undefined = queries?.getTrace(runId, requestId)
        if (!trace) {
          const report = reportForRun(ctx.nxMkDir, runId)
          const summary = report?.requests.find((r) => r.requestId === requestId)
          if (!summary) return reply.code(404).send({ error: `unknown request: ${requestId}` })
          trace = {
            id: `rt_${runId}_${requestId}`, runId, traceId: requestId,
            scenarioId: null, dslStepId: null, endpointId: summary.endpointId ?? null,
            method: summary.method ?? '', url: summary.url ?? '', path: summary.path ?? null,
            status: summary.status ?? null, durationMs: summary.durationMs ?? null,
            startedAt: summary.startedAt ?? null, endedAt: summary.endedAt ?? null,
            replayable: null, replaySafety: null, replayReason: null,
            responsePreview: summary.responsePreview ?? null,
          }
        }
        const res: RequestDetailResponse = {
          trace,
          hits: queries?.listHitsByRequest(runId, requestId) ?? [],
          evidence: queries?.listEvidenceByRequest(runId, requestId) ?? [],
        }
        return res
      } finally {
        reader?.close()
      }
    } catch (err) {
      if (err instanceof DbBusyError) return busy503(reply)
      throw err
    }
  })
}
