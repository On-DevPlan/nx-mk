/** GET /api/runs/:runId/ignored（spec §3.5）：report 的 ignoredReturnedFields 清单 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { reportForRun } from '../store/report-reader.js'
import type { IgnoredListResponse } from '../../shared/api-types.js'

export function registerIgnoredRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/runs/:runId/ignored', async (req, reply) => {
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
    return { ignored: report.ignoredReturnedFields } satisfies IgnoredListResponse
  })
}
