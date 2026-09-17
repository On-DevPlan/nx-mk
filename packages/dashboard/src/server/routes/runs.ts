/**
 * GET /api/runs、GET /api/runs/:runId（spec §3.5）。
 * 目录扫描为主键来源；db 行可选富化；DbBusyError → 503（spec §4）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { RouteContext } from '../types.js'
import { listRuns } from '../store/runs-store.js'
import { readCoverageReport, reportForRun } from '../store/report-reader.js'
import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
import { Queries } from '../store/queries.js'
import type { RunListItem, RunsListResponse, RunDetailResponse } from '../../shared/api-types.js'

/** DbBusyError → 503 + hint；其余原样上抛（fastify 500 可见） */
function busyGuard(reply: FastifyReply, err: unknown): { handled: boolean } {
  if (err instanceof DbBusyError) {
    void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
    return { handled: true }
  }
  throw err
}

export function registerRunRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const readerOpts = { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS }

  app.get('/api/runs', async (_req, reply) => {
    try {
      const fileRuns = listRuns(ctx.nxMkDir)
      const report = readCoverageReport(ctx.nxMkDir)
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
      let runs: RunListItem[]
      try {
        const queries = reader ? new Queries(reader) : null
        runs = [...fileRuns].reverse().map(({ runId, hasEvents }) => {
          const row = queries?.getRun(runId)
          const item: RunListItem = {
            runId,
            hasEvents,
            hasReport: report !== null && report.runId === runId,
            ...(row?.status !== undefined ? { status: row.status } : {}),
            ...(row?.startedAt != null ? { startedAt: row.startedAt } : {}),
            ...(row?.endedAt != null ? { endedAt: row.endedAt } : {}),
            ...(row?.terminatedBy != null ? { terminatedBy: row.terminatedBy } : {}),
          }
          return item
        })
      } finally {
        reader?.close()
      }
      const res: RunsListResponse = {
        runs,
        manifestAvailable: existsSync(join(ctx.nxMkDir, 'manifest.json')),
      }
      return res
    } catch (err) {
      busyGuard(reply, err)
    }
  })

  app.get('/api/runs/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    try {
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), readerOpts)
      try {
        const row = reader ? new Queries(reader).getRun(runId) ?? null : null
        const report = reportForRun(ctx.nxMkDir, runId)
        const res: RunDetailResponse = {
          runId,
          hasEvents: existsSync(join(ctx.nxMkDir, 'runs', runId, 'events.jsonl')),
          hasReport: report !== null,
          ...(row?.status !== undefined ? { status: row.status } : {}),
          ...(row?.startedAt != null ? { startedAt: row.startedAt } : {}),
          ...(row?.endedAt != null ? { endedAt: row.endedAt } : {}),
          ...(row?.terminatedBy != null ? { terminatedBy: row.terminatedBy } : {}),
          dbRow: row,
        }
        return res
      } finally {
        reader?.close()
      }
    } catch (err) {
      busyGuard(reply, err)
    }
  })
}
