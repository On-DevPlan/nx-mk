/**
 * demo 闭环第三段（Plan §42.5）：.nx-mk/manifest.json → typed SDK → app/src/generated-sdk.ts
 *
 * 前置两段：
 *   1. `pnpm demo:openapi`   —— demo/server 产出 swagger/openapi.json
 *   2. `nx-mk run`（demo 目录）—— plugin-swagger 解析 swagger.json 产出 .nx-mk/manifest.json
 *
 * manifest.json 由 plugin-swagger 从真实 OpenAPI 生成（含 named refs，Phase 1.5 起），
 * 不再手工构造。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { generateSdk } from '../../packages/client/dist/codegen.js'

const manifestPath = new URL('./.nx-mk/manifest.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const code = generateSdk(manifest, { baseUrl: '/api' })
writeFileSync(new URL('./app/src/generated-sdk.ts', import.meta.url), code)
console.log(`[codegen] wrote app/src/generated-sdk.ts (${code.length} bytes)`)
