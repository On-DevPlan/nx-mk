/**
 * 把 OpenAPI 文档落盘到 ../swagger/openapi.json
 * 用于：nx-mk plugin-swagger 的输入（替代手写 swagger.json）
 * 触发：pnpm demo:openapi（或 CI 在 server 启动后调用）
 *
 * 写法：用 @hono/zod-openapi 的 app.getOpenAPIDocument() 拿 spec，再 .toJSON() 序列化。
 * 不启动 HTTP server，只读取路由表 → 序列化 → 写文件。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, '..', '..', 'swagger', 'openapi.json')
mkdirSync(dirname(outPath), { recursive: true })

const spec = app.getOpenAPIDocument({
  openapi: '3.0.3',
  info: {
    title: 'nx-mk demo API',
    version: '0.1.0',
    description: 'Phase 1.5 SDK Facade demo backend',
  },
})
writeFileSync(outPath, JSON.stringify(spec, null, 2))
console.log(`[demo/openapi] wrote ${outPath}`)
