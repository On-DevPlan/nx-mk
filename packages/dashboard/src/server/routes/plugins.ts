/**
 * GET /api/plugins（Phase 4.5 R6）+ PATCH /api/plugins/:name/config（v1 W1/W2）。
 * 路由只做形状门（E1）+ 错误码映射（E2-E7 → HTTP）；写回本体在 @nx-mk/config writeback（WP1，
 * dashboard server 铁律白名单仍只有 replay.ts 一个写文件者）。
 */
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { readPluginsManifest } from '../store/plugins-reader.js'
import { previewConfigWrite, applyConfigWrite, ConfigWriteError } from '@nx-mk/config'
import type { ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../../shared/api-types.js'

// ConfigWriteErrorCode → HTTP（spec §3：E2/E3/E5 409、E4 404、E6 500；E1 形状门在下方独立处理）
function statusForWriteError(code: ConfigWriteError['code']): number {
  if (code === 'PLUGIN_NOT_IN_CONFIG') return 404
  if (code === 'YAML_SELF_HARM') return 500
  return 409
}

export function registerPluginRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/plugins', async () => readPluginsManifest(ctx.nxMkDir))

  app.patch('/api/plugins/:pluginName/config', async (req, reply) => {
    // configPath 未接线（start 未发现配置文件）→ 与 E2 同语义诚实降级（WP 裁定）
    if (!ctx.configPath) {
      return reply.code(409).send({ error: 'config file not found' })
    }
    const { pluginName } = req.params as { pluginName: string }
    const body = (req.body ?? {}) as { config?: unknown; yamlSha?: unknown }
    // E1（WP2 形状门）：config 必须是 JSON object；深度 configSchema 校验在 kernel 下次 run fail-fast
    if (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config)) {
      return reply.code(400).send({ error: 'config must be a JSON object', errors: ['config must be a JSON object'] })
    }
    // WP4：缺省 dryRun=true（安全默认）；仅显式 false 才落盘
    const dryRun = (req.query as { dryRun?: string }).dryRun !== 'false'
    if (!dryRun && typeof body.yamlSha !== 'string') {
      return reply.code(400).send({ error: 'yamlSha required for apply (preview first)' })
    }
    try {
      if (dryRun) {
        const preview = previewConfigWrite(ctx.configPath, pluginName, body.config as Record<string, unknown>)
        return preview satisfies ConfigWritePreviewResponse
      }
      const result = applyConfigWrite(
        ctx.configPath,
        pluginName,
        body.config as Record<string, unknown>,
        body.yamlSha as string,
      )
      return result satisfies ConfigWriteApplyResponse
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        return reply.code(statusForWriteError(err.code)).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })
}
