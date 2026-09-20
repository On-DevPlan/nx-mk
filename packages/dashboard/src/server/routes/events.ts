/**
 * GET /api/events（spec §2.1 SSE）：text/event-stream；?runId= 过滤单 run。
 * reply.hijack 后写 raw 流；客户端断开 → tail.stop() + 心跳清理。
 * 15s 心跳注释行防代理/空闲超时掐断。
 */
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { EventTail } from '../event-tail.js'

export function registerEventRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/events', (req, reply) => {
    const q = req.query as { runId?: string }
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    raw.write('retry: 2000\n\n')
    const tail = new EventTail({ nxMkDir: ctx.nxMkDir, ...(q.runId !== undefined ? { runId: q.runId } : {}) }, (evt) => {
      if (raw.destroyed) return
      raw.write(`data: ${JSON.stringify(evt)}\n\n`)
    })
    tail.start()
    const heartbeat = setInterval(() => {
      if (!raw.destroyed) raw.write(': ping\n\n')
    }, 15_000)
    req.raw.on('close', () => {
      clearInterval(heartbeat)
      tail.stop()
      if (!raw.writableEnded) raw.end()
    })
  })
}