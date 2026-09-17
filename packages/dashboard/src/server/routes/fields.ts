/**
 * GET /api/runs/:runId/fields（spec §3.5）：coverage_fields 行为基座；
 * report 命中该 run 时按 fieldPath 富化 hitCount/matchedRule（两值不在 §25.8 列中）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { RouteContext } from '../types.js'
import { reportForRun } from '../store/report-reader.js'
import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
import { Queries } from '../store/queries.js'
import type { FieldsListResponse } from '../../shared/api-types.js'
import type { FieldCoverageItem } from '@nx-mk/coverage'

function busy503(reply: FastifyReply): { handled: true } {
  void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
  return { handled: true }
}

export function registerFieldRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/runs/:runId/fields', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    try {
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS })
      try {
        if (!reader) return { fields: [] } satisfies FieldsListResponse
        const rows = new Queries(reader).listCoverageFields(runId)
        const report = reportForRun(ctx.nxMkDir, runId)
        const items: FieldCoverageItem[] = report
          ? [
              ...report.missingRequiredFields,
              ...report.weakEvidenceFields,
              ...report.ignoredReturnedFields,
              ...report.suspiciousCoverage,
            ]
          : []
        const byPath = new Map(items.map((i) => [i.fieldPath, i]))
        const res: FieldsListResponse = {
          fields: rows.map((row) => {
            const item = byPath.get(row.fieldPath)
            return {
              ...row,
              ...(item?.hitCount !== undefined ? { hitCount: item.hitCount } : {}),
              ...(item?.matchedRule !== undefined ? { matchedRule: item.matchedRule } : {}),
            }
          }),
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
