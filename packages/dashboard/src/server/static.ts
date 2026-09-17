/**
 * 静态托管（spec §3.3）：GET / → index.html；GET /assets/:name → dist-ui/assets/ 下文件。
 * hash 路由使页面路径全部位于 #/ 之后，server 永远只见 /，无需 SPA fallback。
 * 路径安全（spec §4）：:name 不跨段（find-my-way 语义）+ decodeURIComponent 后
 * resolve 强制落在 assets root 内；穿越矩阵用例测试锁定。
 */
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
}

export function registerStatic(app: FastifyInstance, uiDistDir: string): void {
  const root = resolve(uiDistDir)
  const assetsRoot = join(root, 'assets')

  app.get('/', async (_req, reply) => {
    try {
      const html = await readFile(join(root, 'index.html'))
      return reply.type('text/html; charset=utf-8').send(html)
    } catch {
      return reply.code(404).send({
        error: 'dashboard UI not built',
        hint: 'run: corepack pnpm --filter @nx-mk/dashboard build',
      })
    }
  })

  app.get('/assets/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    let decoded: string
    try {
      decoded = decodeURIComponent(name)
    } catch {
      return reply.code(404).send()
    }
    // 归一化后强制在 assets root 内（../、绝对路径、编码变体一律 404）
    const abs = resolve(assetsRoot, decoded)
    if (!abs.startsWith(assetsRoot + sep)) return reply.code(404).send()
    if (!existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send()
    const dot = abs.lastIndexOf('.')
    const type = dot === -1 ? 'application/octet-stream' : MIME[abs.slice(dot)] ?? 'application/octet-stream'
    const body = await readFile(abs)
    return reply.type(type).send(body)
  })
}
