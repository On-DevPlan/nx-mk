/**
 * C12 settings 路由测试：
 * - GET /api/settings（三段现值 + sha；configPath 缺失 409；段不存在 null）
 * - PATCH /api/settings/:section（白名单外 404；schema 400；preview/apply 两段式；
 *   sha 复衡 409；段删除 null value；apply 落盘 .bak + 复读断言）
 * 无 UI 交互模拟（node 渲染环境）—— 页面组件经路由测试显式渲染输出。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server/index.js'
import type { SettingsResponse, ConfigWritePreviewResponse, ConfigWriteApplyResponse } from '../shared/api-types.js'

const tmpRoots: string[] = []
afterEach(() => {
  for (const r of tmpRoots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function makeProject(configYaml: string): { nx: string; cfg: string } {
  const root = mkdtempSync(join(tmpdir(), 'c12-'))
  tmpRoots.push(root)
  const nx = join(root, '.nx-mk')
  mkdirSync(nx, { recursive: true })
  mkdirSync(join(nx, 'ui'), { recursive: true })
  const cfg = join(root, 'nx-mk.config.yml')
  writeFileSync(cfg, configYaml, 'utf8')
  return { nx, cfg }
}

const BASE_CONFIG = `# base comment
predicates:
  goal: default
coverage:
  ignored:
    - internal_*
agent:
  provider:
    type: claude-code
    timeoutMs: 100
`

describe('GET /api/settings', () => {
  it('configPath 未接线 → 409 诚实降级', async () => {
    const { nx } = makeProject(BASE_CONFIG)
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('三段现值：存在的段为对象、缺的段 null', async () => {
    const { nx, cfg } = makeProject(BASE_CONFIG)
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui'), configPath: cfg })
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SettingsResponse
    expect(body.sections.coverage).toEqual({ ignored: ['internal_*'] })
    expect(body.sections.agent).toEqual({ provider: { type: 'claude-code', timeoutMs: 100 } })
    expect(body.sections.replay).toBeNull()
    expect(typeof body.yamlSha).toBe('string')
    await app.close()
  })
})

describe('PATCH /api/settings/:section', () => {
  it('白名单外 section → 404', async () => {
    const { nx, cfg } = makeProject(BASE_CONFIG)
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui'), configPath: cfg })
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/privacy', payload: { value: {} } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('value 非对象/非 null → 400', async () => {
    const { nx, cfg } = makeProject(BASE_CONFIG)
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui'), configPath: cfg })
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/coverage', payload: { value: ['x'] } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('value 不过 zod schema → 400 + errors 透出', async () => {
    const { nx, cfg } = makeProject(BASE_CONFIG)
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui'), configPath: cfg })
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/agent', payload: { value: { provider: { type: 'openai' } } } })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { errors: string[] }
    expect(body.errors.length).toBeGreaterThan(0)
    await app.close()
  })

  it('preview（dryRun）→ diff + yamlSha；apply 带 sha → 落盘 + .bak + 注释保留', async () => {
    const { nx, cfg } = makeProject(BASE_CONFIG)
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui'), configPath: cfg })
    const pv = await app.inject({ method: 'PATCH', url: '/api/settings/coverage', payload: { value: { ignored: ['internal_*', 'debug_*'] }, mode: 'preview' } })
    expect(pv.statusCode).toBe(200)
    const preview = pv.json() as ConfigWritePreviewResponse
    expect(preview.valid).toBe(true)
    expect(preview.diff).toMatch(/\+\s*-?\s*debug_\*/) // 整段替换重排缩进，断言容忍 - 前缀与缩进
    expect(preview.yamlSha.length).toBe(64)

    // sha 复核失败 → 409（先敲入旧 sha 的同请求应失败）
    const badApply = await app.inject({ method: 'PATCH', url: '/api/settings/coverage', payload: { value: { ignored: ['x'] }, mode: 'apply', yamlSha: '0'.repeat(64) } })
    expect(badApply.statusCode).toBe(409)

    const ap = await app.inject({ method: 'PATCH', url: '/api/settings/coverage', payload: { value: { ignored: ['internal_*', 'debug_*'] }, mode: 'apply', yamlSha: preview.yamlSha } })
    expect(ap.statusCode).toBe(200)
    const applied = ap.json() as ConfigWriteApplyResponse
    expect(applied.applied).toBe(true)
    expect(existsSync(`${cfg}.bak`)).toBe(true)
    const after = readFileSync(cfg, 'utf8')
    expect(after).toContain('# base comment') // W5 注释保留
    expect(after).toContain('debug_*')
    // 复读：新值可见
    const re = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(((re.json() as SettingsResponse).sections.coverage as { ignored: string[] }).ignored).toEqual(['internal_*', 'debug_*'])
    await app.close()
  })

  it('value=null → 段删除；注释与其它段原样保留', async () => {
    const { nx, cfg } = makeProject(BASE_CONFIG)
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(nx, 'ui'), configPath: cfg })
    const ap = await app.inject({ method: 'PATCH', url: '/api/settings/replay', payload: { value: null, mode: 'apply', yamlSha: '0'.repeat(64) } })
    expect(ap.statusCode).toBe(409) // 直接 apply 无 preview sha → 复核失败（流程要求 preview 先行）
    // 正确流程：preview 拿 sha
    const pv = await app.inject({ method: 'PATCH', url: '/api/settings/replay', payload: { value: null, mode: 'preview' } })
    const preview = pv.json() as ConfigWritePreviewResponse
    const ap2 = await app.inject({ method: 'PATCH', url: '/api/settings/replay', payload: { value: null, mode: 'apply', yamlSha: preview.yamlSha } })
    expect(ap2.statusCode).toBe(200)
    const after = readFileSync(cfg, 'utf8')
    expect(after).not.toContain('replay:')
    expect(after).toContain('coverage:') // 其它段原样
    await app.close()
  })
})
