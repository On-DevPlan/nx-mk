/**
 * PATCH /api/plugins/:name/config（spec §2.3 + E1-E7 矩阵，WP4 缺省 dryRun=true）。
 * 路由只做形状门 + 错误码映射；写回本体由 @nx-mk/config writeback 承担（WP1）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { buildServer } from '../server/index.js'
import { makeNxMkDir } from './fixtures.js'
import { sha256Text } from '@nx-mk/config'
import type { FastifyInstance } from 'fastify'
import type { ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../shared/api-types.js'

const BASE_YAML = [
  '# 用户主配置',
  'logLevel: info',
  'plugins:',
  '  # 采集插件',
  "  - '@nx-mk/plugin-playwright'",
  '  - name: \'@nx-mk/plugin-swagger\'',
  '    config:',
  '      maxTurns: 3',
  '',
].join('\n')

// 插件名含 / 与 @ —— 路径参数必须 URL 编码（find-my-way 按 / 分段，%2F 不切段）
const PW = encodeURIComponent('@nx-mk/plugin-playwright')
const SW = encodeURIComponent('@nx-mk/plugin-swagger')

describe('PATCH /api/plugins/:pluginName/config', () => {
  let dir: string
  let configPath: string
  let app: FastifyInstance

  function build(): void {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui'), configPath })
  }
  beforeEach(() => {
    dir = makeNxMkDir([])
    configPath = join(dirname(dir), 'nx-mk.config.yml')
    writeFileSync(configPath, BASE_YAML, 'utf8')
  })
  afterEach(async () => {
    await app.close()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('缺省 dryRun=true：200 preview，diff 含 +/-，文件不动（E-门：写不发生）', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: { maxTurns: 9 } },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ConfigWritePreviewResponse
    expect(body.valid).toBe(true)
    expect(body.yamlSha).toBe(sha256Text(BASE_YAML))
    expect(body.diff).toContain('maxTurns: 9')
    expect(readFileSync(configPath, 'utf8')).toBe(BASE_YAML)
  })

  it('E4：插件不在 plugins 列表 → 404', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${encodeURIComponent('ghost-pkg')}/config`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(404)
  })

  it('E1：config 非 JSON object → 400', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: 'not-an-object' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('E2：config 文件缺失 → 409', async () => {
    rmSync(configPath)
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(409)
  })

  it('E3：config 不可解析 → 409', async () => {
    writeFileSync(configPath, 'plugins: [unclosed', 'utf8')
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(409)
  })

  it('apply 全链路：preview → dryRun=false 落盘 + .bak 产生 + 内容变更', async () => {
    build()
    const preview = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config?dryRun=true`,
      payload: { config: { maxTurns: 9 } },
    })
    const { yamlSha } = preview.json() as ConfigWritePreviewResponse
    const apply = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config?dryRun=false`,
      payload: { config: { maxTurns: 9 }, yamlSha },
    })
    expect(apply.statusCode).toBe(200)
    const body = apply.json() as ConfigWriteApplyResponse
    expect(body.applied).toBe(true)
    expect(readFileSync(body.bakPath, 'utf8')).toBe(BASE_YAML)
    expect(readFileSync(configPath, 'utf8')).toContain('maxTurns: 9')
  })

  it('E5：apply 带过期 sha → 409，文件保持原样', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config?dryRun=false`,
      payload: { config: {}, yamlSha: 'deadbeef' },
    })
    expect(res.statusCode).toBe(409)
    expect(readFileSync(configPath, 'utf8')).toBe(BASE_YAML)
    expect(existsSync(`${configPath}.bak`)).toBe(false)
  })

  it('apply 缺 yamlSha → 400（两段式的门）', async () => {
    build()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config?dryRun=false`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  it('configPath 未接线（start 未发现配置文件）→ 409 诚实降级', async () => {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plugins/${SW}/config`,
      payload: { config: {} },
    })
    expect(res.statusCode).toBe(409)
  })
})
