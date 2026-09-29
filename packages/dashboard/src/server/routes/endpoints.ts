/**
 * GET /api/runs/:runId/endpoints（C14，§30.2 补路由）：per-endpoint 覆盖列表。
 * 数据源 = coverage-report.json 的 endpoints 数组（reportForRun，D12 门控：
 * report 是最新 run 的覆盖写产物，旧 run 查询按缺失 404 —— 与 metrics 同语义）。
 * 不读 endpoints 表（§25.2 行未含 coverage 维度）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { reportForRun } from '../store/report-reader.js'
import type { EndpointsListResponse } from '../../shared/api-types.js'

export function registerEndpointRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/runs/:runId/endpoints', async (req, reply) => {
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
    const res: EndpointsListResponse = { endpoints: report.endpoints }
    return res
  })
}
