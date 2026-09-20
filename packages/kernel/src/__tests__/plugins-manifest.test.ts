/**
 * plugins-manifest.json 落盘单测（Phase 4.5 R7）：
 * 形状 / configSchema 序列化降级（E5）/ config 全量快照语义（V5）/ IO 失败静默。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from '../plugin.js'
import { buildPluginsManifest, writePluginsManifest } from '../plugins-manifest.js'

const fakeSchemaWithJson = {
  '~standard': { validate: () => {} },
  jsonSchema: { type: 'object', properties: { url: { type: 'string' } } },
} as unknown as Plugin['configSchema']

const schemaWithoutJson = { '~standard': { validate: () => {} } } as unknown as Plugin['configSchema']

describe('buildPluginsManifest', () => {
  it('serializes name/version/enabled/config/configSchema', () => {
    const p: Plugin = { name: '@nx-mk/plugin-swagger', version: '0.1.0', hooks: {}, configSchema: fakeSchemaWithJson }
    const m = buildPluginsManifest([p], { logLevel: 'info' } as never)
    expect(m.plugins).toHaveLength(1)
    const e = m.plugins[0]!
    expect(e.name).toBe('@nx-mk/plugin-swagger')
    expect(e.version).toBe('0.1.0')
    expect(e.enabled).toBe(true)
    expect(e.config).toEqual({ logLevel: 'info' })
    expect(e.configSchema).toEqual({ type: 'object', properties: { url: { type: 'string' } } })
    expect(typeof m.generatedAt).toBe('string')
  })

  it('configSchema without jsonSchema prop → null (E5/R8)', () => {
    const p: Plugin = { name: 'bare', version: '1.0.0', hooks: {}, configSchema: schemaWithoutJson }
    expect(buildPluginsManifest([p], undefined).plugins[0]!.configSchema).toBeNull()
  })

  it('plugin without configSchema → null; undefined config → null', () => {
    const m = buildPluginsManifest([{ name: 'x', version: '1', hooks: {} }], undefined)
    expect(m.plugins[0]!.configSchema).toBeNull()
    expect(m.plugins[0]!.config).toBeNull()
  })
})

describe('writePluginsManifest', () => {
  it('writes .nx-mk/plugins-manifest.json under cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nx-mk-pm-'))
    try {
      writePluginsManifest(dir, buildPluginsManifest([], undefined))
      const parsed: unknown = JSON.parse(readFileSync(join(dir, '.nx-mk', 'plugins-manifest.json'), 'utf8'))
      expect((parsed as { plugins: unknown[] }).plugins).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('IO failure is silent (E4 downstream handles missing file)', () => {
    // cwd 指向一个文件 → mkdir/write 必失败 → 不抛
    const dir = mkdtempSync(join(tmpdir(), 'nx-mk-pm-'))
    const blocker = join(dir, 'file')
    writeFileSync(blocker, 'x')
    expect(() => writePluginsManifest(blocker, buildPluginsManifest([], undefined))).not.toThrow()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('kernel integration: manifest written after run', () => {
  it('writes plugins-manifest.json when a run completes', async () => {
    const { createKernel } = await import('../kernel.js')
    const dir = mkdtempSync(join(tmpdir(), 'nx-mk-pm-run-'))
    const configPath = join(dir, 'nx-mk.config.yml')
    // 最小可运行配置（对齐 kernel.test.ts writeConfig 的形状）
    writeFileSync(configPath, 'plugins: []\nlogLevel: info\n', 'utf8')
    const p: Plugin = { name: '@nx-mk/idle', version: '1.0.0', hooks: {} }
    try {
      const kernel = createKernel({ configPath, runId: 'r_pm' as never, subcommand: 'run', cwd: dir, plugins: [p] })
      await kernel.run()
      const parsed: unknown = JSON.parse(readFileSync(join(dir, '.nx-mk', 'plugins-manifest.json'), 'utf8'))
      const entries = (parsed as { plugins: { name: string }[] }).plugins
      expect(entries.map((e) => e.name)).toContain('@nx-mk/idle')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
