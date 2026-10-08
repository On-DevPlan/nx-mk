/** 把 OpenAPI 文档落盘到 ../swagger/openapi.json —— plugin-swagger 的输入 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, '..', '..', 'swagger', 'openapi.json')
mkdirSync(dirname(outPath), { recursive: true })

const spec = app.getOpenAPIDocument({
  openapi: '3.0.3',
  info: { title: 'nx-mk commerce orders API', version: '0.1.0', description: '验证项目二：分页 envelope + 深层数组' },
})
writeFileSync(outPath, JSON.stringify(spec, null, 2))
console.log(`[orders/openapi] wrote ${outPath}`)
