/**
 * GET /api/plugins（spec R6）：只读装配 plugins-manifest.json（kernel R7 产物）。
 * 无写回（R6：PATCH 推 v1）。
 */
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { readPluginsManifest } from '../store/plugins-reader.js'

export function registerPluginRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/plugins', async () => readPluginsManifest(ctx.nxMkDir))
}