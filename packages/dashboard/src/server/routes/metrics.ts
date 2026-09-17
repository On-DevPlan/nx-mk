/** GET /api/runs/:runId/metrics（spec §3.5）：report 命中 → 三指标 + 状态富化 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { reportForRun } from '../store/report-reader.js'
import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
import { Queries } from '../store/queries.js'
import type { MetricsResponse } from '../../shared/api-types.js'

export function registerMetricsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/runs/:runId/metrics', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    const report = reportForRun(ctx.nxMkDir, runId)
    if (!report) {
      return reply.code(404).send({
        error: 'coverage report unavailable',
        hint: 'coverage-report.json is written at run end; re-run nx-mk run',
      })
    }
    // 状态富化失败（busy 等）不阻断 metrics 返回——降级精神（spec §4）
    let status: string | undefined
    let terminatedBy: string | undefined
    try {
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS })
      try {
        const row = reader ? new Queries(reader).getRun(runId) : undefined
        if (row?.status !== undefined) status = row.status
        if (row?.terminatedBy != null) terminatedBy = row.terminatedBy
      } finally {
        reader?.close()
      }
    } catch (err) {
      if (!(err instanceof DbBusyError)) throw err
    }
    const res: MetricsResponse = {
      runId,
      ...(status !== undefined ? { status } : {}),
      ...(terminatedBy !== undefined ? { terminatedBy } : {}),
      metrics: report.metrics,
    }
    return res
  })
}
