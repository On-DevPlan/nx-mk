import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardConfigSchema, ConfigSchema } from '../schema.js'
import { loadConfig } from '../loader.js'
import { makeRunId } from '@nx-mk/kernel'

describe('DashboardConfigSchema', () => {
  it('accepts port + open', () => {
    expect(DashboardConfigSchema.parse({ port: 5000, open: false })).toEqual({ port: 5000, open: false })
  })
  it('accepts empty object', () => {
    expect(DashboardConfigSchema.parse({})).toEqual({})
  })
  it.each([0, -1, 70000, 1.5, '4317'])('rejects invalid port %p', (port) => {
    expect(DashboardConfigSchema.safeParse({ port }).success).toBe(false)
  })
  it('embedded in ConfigSchema (optional, passthrough preserved)', () => {
    const parsed = ConfigSchema.parse({ dashboard: { port: 4317 } })
    expect(parsed.dashboard).toEqual({ port: 4317 })
    expect(ConfigSchema.parse({}).dashboard).toBeUndefined()
  })
})

describe('loadConfig with dashboard section + start subcommand', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-cfg-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('parses dashboard section with subcommand start', async () => {
    const path = join(dir, 'nx-mk.config.yml')
    writeFileSync(path, 'plugins: []\ndashboard:\n  port: 5000\n  open: false\n')
    const cfg = await loadConfig({ path, cwd: dir, runId: makeRunId('run_t'), subcommand: 'start' })
    expect(cfg.dashboard).toEqual({ port: 5000, open: false })
  })
  it('invalid dashboard.port → KernelError CONFIG_INVALID', async () => {
    const path = join(dir, 'nx-mk.config.yml')
    writeFileSync(path, 'dashboard:\n  port: 70000\n')
    await expect(
      loadConfig({ path, cwd: dir, runId: makeRunId('run_t'), subcommand: 'start' }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })
})
