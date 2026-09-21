/**
 * buildServer —— Dashboard server 工厂（spec §3.2）：
 * 静态托管 + 7 条只读 /api 路由 + Phase 4.5 可操作路由（replay, SSE events, plugins, manifest）。
 * logger 关闭：本地分析台，stdout 由 start 命令管理。
 */
import Fastify, { type FastifyInstance } from 'fastify'
import { registerStatic } from './static.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerMetricsRoutes } from './routes/metrics.js'
import { registerRequestRoutes } from './routes/requests.js'
import { registerFieldRoutes } from './routes/fields.js'
import { registerIgnoredRoutes } from './routes/ignored.js'
import { registerReplayRoutes } from './routes/replay.js'
import { registerEventRoutes } from './routes/events.js'
import { registerPluginRoutes } from './routes/plugins.js'
import { registerManifestRoutes } from './routes/manifest.js'
import { registerScenarioRoutes } from './routes/scenarios.js'

export interface BuildServerOptions {
  /** .nx-mk 目录（绝对或相对 cwd） */
  nxMkDir: string
  /** UI 产物目录（index.html 所在） */
  uiDistDir: string
  /** SQLite busy_timeout 覆盖（测试注入小值）；缺省 2000ms */
  busyTimeoutMs?: number
  /** 用户主配置文件绝对路径（start 命令发现后透传；缺省 = 写回 API 以 409 诚实降级） */
  configPath?: string
}

export function buildServer(opts: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false })
  registerStatic(app, opts.uiDistDir)
  const ctx = {
    nxMkDir: opts.nxMkDir,
    ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
    ...(opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: opts.busyTimeoutMs } : {}),
  }
  registerRunRoutes(app, ctx)
  registerMetricsRoutes(app, ctx)
  registerRequestRoutes(app, ctx)
  registerFieldRoutes(app, ctx)
  registerIgnoredRoutes(app, ctx)
  registerReplayRoutes(app, ctx)
  registerEventRoutes(app, ctx)
  registerPluginRoutes(app, ctx)
  registerManifestRoutes(app, ctx)
  registerScenarioRoutes(app, ctx)
  return app
}

export { resolveUiDistDir } from './ui-dir.js'
