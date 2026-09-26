/**
 * GET /api/runs/:runId/pipeline —— 流水线逐步报告（Pipeline 页）：
 * events.jsonl（phase/plugin/turn/goal/scenario）+ run manifest + coverage-report（D12 门控）
 * 全部只读聚合；run 不存在 → 404。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { readPipelineEvents, readPipelineReport } from '../store/pipeline-reader.js'
import type { PipelineEventsResponse, PipelineReportResponse } from '../../shared/api-types.js'

export function registerPipelineRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/runs/:runId/pipeline', async (req, reply): Promise<PipelineReportResponse | void> => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    return readPipelineReport(ctx.nxMkDir, runId)
  })

  // 原始事件逐条 I/O（聚合视图的底层数据，供 Pipeline 页「Raw events」展开查看）
  app.get('/api/runs/:runId/pipeline/events', async (req, reply): Promise<PipelineEventsResponse | void> => {
    const { runId } = req.params as { runId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    return readPipelineEvents(ctx.nxMkDir, runId)
  })
}
