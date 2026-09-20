/**
 * /api/plugins + /api/runs/:runId/manifest 路由测试（Phase 4.5）：
 * E4 stale 降级 / 逐条 sanitize / E8 404 / 形状门。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { buildServer } from '../server/index.js'
import { makeNxMkDir } from './fixtures.js'
import type { FastifyInstance } from 'fastify'
import type { PluginsResponse, ManifestResponse } from '../shared/api-types.js'

const VALID_MANIFEST_FILE = {
  generatedAt: '2026-09-20T10:00:00.000Z',
  plugins: [
    { name: '@nx-mk/plugin-swagger', version: '0.1.0', enabled: true, config: { logLevel: 'info' }, configSchema: { type: 'object' } },
    { name: 'bare-plugin', version: '1.0.0', enabled: true, config: null, configSchema: null },
    { name: 42, version: 'bad' }, // 非法条目 → 跳过
  ],
}

const VALID_RUN_MANIFEST = {
  version: '1',
  source: { type: 'openapi', input: 'openapi.json', hash: 'h1' },
  generatedAt: '2026-09-20T09:00:00.000Z',
  schemas: {},
  fields: [
    { id: 'f1', endpointId: 'e1', direction: 'response', path: 'data.id', normalizedPath: 'data.id', name: 'id', type: 'integer', required: true },
  ],
  endpoints: [{ id: 'e1', method: 'GET', path: '/users/{id}' }],
}

describe('GET /api/plugins（E4/E5/R8）', () => {
  let dir: string
  let app: FastifyInstance

  function build(): void {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
  }
  beforeEach(() => {
    dir = makeNxMkDir([{ runId: 'run_a' }])
  })
  afterEach(async () => {
    await app.close()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('清单在 → 逐条返回；非法条目跳过；configSchema null 保留', async () => {
    writeFileSync(join(dir, 'plugins-manifest.json'), JSON.stringify(VALID_MANIFEST_FILE))
    build()
    const res = await app.inject({ method: 'GET', url: '/api/plugins' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as PluginsResponse
    expect(body.stale).toBe(false)
    expect(body.plugins).toHaveLength(2)
    expect(body.plugins[0]!.name).toBe('@nx-mk/plugin-swagger')
    expect(body.plugins[0]!.configSchema).toEqual({ type: 'object' })
    expect(body.plugins[1]!.configSchema).toBeNull()
  })

  it('文件缺失 / 形状非法 / JSON 损坏 → {plugins: [], stale: true}（E4）', async () => {
    build()
    expect((await app.inject({ method: 'GET', url: '/api/plugins' })).json() as PluginsResponse).toEqual({ plugins: [], stale: true })
    writeFileSync(join(dir, 'plugins-manifest.json'), '{oops')
    expect((await app.inject({ method: 'GET', url: '/api/plugins' })).json() as PluginsResponse).toEqual({ plugins: [], stale: true })
    writeFileSync(join(dir, 'plugins-manifest.json'), JSON.stringify({ nope: true }))
    expect((await app.inject({ method: 'GET', url: '/api/plugins' })).json() as PluginsResponse).toEqual({ plugins: [], stale: true })
  })
})

describe('GET /api/runs/:runId/manifest（E8）', () => {
  let dir: string
  let app: FastifyInstance

  function build(): void {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
  }
  beforeEach(() => {
    dir = makeNxMkDir([{ runId: 'run_a' }])
  })
  afterEach(async () => {
    await app.close()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('快照在 → 原样透传', async () => {
    writeFileSync(join(dir, 'runs', 'run_a', 'manifest.json'), JSON.stringify(VALID_RUN_MANIFEST))
    build()
    const res = await app.inject({ method: 'GET', url: '/api/runs/run_a/manifest' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ManifestResponse
    expect(body.endpoints).toHaveLength(1)
    expect(body.fields[0]!.path).toBe('data.id')
  })

  it('快照缺失 / JSON 损坏 / 形状不过（{}）→ 404（E8）', async () => {
    build()
    expect((await app.inject({ method: 'GET', url: '/api/runs/run_a/manifest' })).statusCode).toBe(404)
    writeFileSync(join(dir, 'runs', 'run_a', 'manifest.json'), '{oops')
    expect((await app.inject({ method: 'GET', url: '/api/runs/run_a/manifest' })).statusCode).toBe(404)
    writeFileSync(join(dir, 'runs', 'run_a', 'manifest.json'), '{}')
    expect((await app.inject({ method: 'GET', url: '/api/runs/run_a/manifest' })).statusCode).toBe(404)
  })
})