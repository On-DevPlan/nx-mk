/**
 * buildServer —— Dashboard server 工厂（spec §3.2）。
 * 本任务只有静态托管；Task 4 在此追加 7 条 /api 路由注册。
 * logger 关闭：本地分析台，stdout 由 start 命令管理。
 */
import Fastify, { type FastifyInstance } from 'fastify'
import { registerStatic } from './static.js'

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
  return app
}

export { resolveUiDistDir } from './ui-dir.js'
