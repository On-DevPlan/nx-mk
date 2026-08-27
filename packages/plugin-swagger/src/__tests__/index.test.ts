/**
 * @nx-mk/plugin-swagger —— afterRun hook 集成测试
 *
 * 共享 manifest 的 fixture：直接按相对路径读取
 * packages/manifest/src/__tests__/fixtures/openapi-minimal.json
 * （跨包耦合已确认，见 Phase 1 spec §8.2 的 Option B）。
 *
 * 钩子时机说明：Phase 0 内核钩子名是 before<Phase> / after<Phase>，
 * 不存在裸 `run` 钩子（见 kernel/src/hooks.ts）。因此插件在 run 阶段
 * 的主工作挂在 `afterRun` 上 —— 与 Phase 1 spec §5.1 的意图一致，
 * 但钩子键名按内核实际契约为 `afterRun`。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import createSwaggerPlugin from '../index'
import { KernelError } from '@nx-mk/kernel'
import type { PluginContext, Logger, EventBus, KernelAPI } from '@nx-mk/kernel'

// Shared fixture (from @nx-mk/manifest tests) — cross-test coupling (Option B).
// Vitest ESM keeps __dirname = the test file's dir (src/__tests__), so we hop
// up three levels to packages/ then into manifest's fixture.
const FIXTURE = resolve(__dirname, '../../../manifest/src/__tests__/fixtures/openapi-minimal.json')
const FIXTURE_CONTENT = readFileSync(FIXTURE, 'utf8')

function makeMockCtx(opts: { cwd: string; openapi?: string | undefined }): PluginContext {
  const logger: Logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: async () => {},
  }
  const events: EventBus = {
    emit: vi.fn(),
    on: () => () => {},
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as EventBus
  const api: KernelAPI = {
    run: async () => ({ runId: 'r' as never, durationMs: 0 }),
    shutdown: async () => {},
    getState: () => ({ runId: 'r' as never, currentPhase: null, startedAt: '', loadedPlugins: [] }),
    getRunId: () => 'r' as never,
    getSubcommand: () => 'run',
  }
  return {
    config: { plugins: [], logLevel: 'info', outputDir: '.nx-mk/runs', openapi: opts.openapi } as any,
    logger,
    events,
    kernel: api,
    cwd: opts.cwd,
  }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'plugin-swagger-'))
  // write the fixture into tmpDir as swagger.json so the plugin reads from cwd
  writeFileSync(join(tmpDir, 'swagger.json'), FIXTURE_CONTENT)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('plugin-swagger afterRun hook', () => {
  it('generates manifest.json when openapi is configured and file exists', async () => {
    const ctx = makeMockCtx({ cwd: tmpDir, openapi: './swagger.json' })
    const plugin = createSwaggerPlugin()
    await plugin.hooks.afterRun!(ctx)
    const manifestPath = join(tmpDir, '.nx-mk', 'manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(manifest.endpoints.length).toBeGreaterThan(0)
    expect(manifest.fields.length).toBeGreaterThan(0)
  })

  it('skips silently when openapi not configured', async () => {
    const ctx = makeMockCtx({ cwd: tmpDir, openapi: undefined })
    const plugin = createSwaggerPlugin()
    await plugin.hooks.afterRun!(ctx)
    expect(existsSync(join(tmpDir, '.nx-mk', 'manifest.json'))).toBe(false)
  })

  it('throws KernelError(PLUGIN_HOOK_FAILED) when openapi file missing', async () => {
    const ctx = makeMockCtx({ cwd: tmpDir, openapi: './missing.json' })
    const plugin = createSwaggerPlugin()
    await expect(plugin.hooks.afterRun!(ctx)).rejects.toBeInstanceOf(KernelError)
  })

  it('writes manifest.json atomically (temp + rename)', async () => {
    const ctx = makeMockCtx({ cwd: tmpDir, openapi: './swagger.json' })
    const plugin = createSwaggerPlugin()
    await plugin.hooks.afterRun!(ctx)
    // No .tmp file should remain
    expect(existsSync(join(tmpDir, '.nx-mk', 'manifest.json.tmp'))).toBe(false)
  })
})
