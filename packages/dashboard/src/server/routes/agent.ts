/**
 * GET /api/runs/:runId/agent（C14，§30.2 补路由）：agent_iterations 行列表。
 * agent loop 未跑 → 空数组（200；UI 显空态）；coverage.db busy → 503 降级。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { RouteContext } from '../types.js'
import { openReader, DbBusyError, BUSY_TIMEOUT_MS } from '../store/db-reader.js'
import { Queries } from '../store/queries.js'
import type { AgentIterationsResponse } from '../../shared/api-types.js'

function busy503(reply: FastifyReply): void {
  void reply.code(503).send({ error: 'coverage.db busy', hint: 'run in progress, retrying shortly' })
}

export function registerAgentRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/runs/:runId/agent', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    try {
      const reader = openReader(join(ctx.nxMkDir, 'coverage.db'), { busyTimeoutMs: ctx.busyTimeoutMs ?? BUSY_TIMEOUT_MS })
      try {
        const rows = reader ? new Queries(reader).listAgentIterations(runId) : []
        return { iterations: rows } satisfies AgentIterationsResponse
      } finally {
        reader?.close()
      }
    } catch (err) {
      if (err instanceof DbBusyError) return busy503(reply)
      throw err
    }
  })
}
