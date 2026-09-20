/**
 * GET /api/runs/:runId/manifest（spec U6/E8）：per-run manifest 快照原样透传。
 * 缺失/JSON 损坏/形状不过 → 404（对齐既有 run 路由语义；快照是 Task 2 的 CLI 产物，
 * 旧 run 与 manifest 无效的 run 天然无快照 —— 404 是诚实语义）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import type { ManifestResponse } from '../../shared/api-types.js'

function isManifestShaped(v: unknown): v is ManifestResponse {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.fields) && Array.isArray(o.endpoints) && typeof o.version === 'string'
}

export function registerManifestRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/runs/:runId/manifest', async (req, reply) => {
    const { runId } = req.params as { runId: string }
    let raw: string
    try {
      raw = readFileSync(join(ctx.nxMkDir, 'runs', runId, 'manifest.json'), 'utf8')
    } catch {
      return reply.code(404).send({ error: `manifest not found for run: ${runId}` })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return reply.code(404).send({ error: `manifest not found for run: ${runId}` })
    }
    if (!isManifestShaped(parsed)) {
      return reply.code(404).send({ error: `manifest not found for run: ${runId}` })
    }
    return parsed
  })
}