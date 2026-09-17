/**
 * buildServer —— Dashboard server 工厂（spec §3.2）：
 * 静态托管 + 7 条只读 /api 路由。logger 关闭：本地分析台，stdout 由 start 命令管理。
 */
import Fastify, { type FastifyInstance } from 'fastify'
import { registerStatic } from './static.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerMetricsRoutes } from './routes/metrics.js'
import { registerRequestRoutes } from './routes/requests.js'
import { registerFieldRoutes } from './routes/fields.js'
import { registerIgnoredRoutes } from './routes/ignored.js'

export interface BuildServerOptions {
  /** .nx-mk 目录（绝对或相对 cwd） */
  nxMkDir: string
  /** UI 产物目录（index.html 所在） */
  uiDistDir: string
  /** SQLite busy_timeout 覆盖（测试注入小值）；缺省 2000ms */
  busyTimeoutMs?: number
}

export function buildServer(opts: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false })
  registerStatic(app, opts.uiDistDir)
  const ctx = { nxMkDir: opts.nxMkDir, ...(opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: opts.busyTimeoutMs } : {}) }
  registerRunRoutes(app, ctx)
  registerMetricsRoutes(app, ctx)
  registerRequestRoutes(app, ctx)
  registerFieldRoutes(app, ctx)
  registerIgnoredRoutes(app, ctx)
  return app
}

export { resolveUiDistDir } from './ui-dir.js'
