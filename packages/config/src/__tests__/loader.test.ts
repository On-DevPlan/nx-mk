import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findConfigFile, loadConfig } from '../loader'
import { KernelError, makeRunId } from '@nx-mk/kernel'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-cfg-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('findConfigFile', () => {
  it('returns absolute path when nx-mk.config.yml exists in cwd', async () => {
    writeFileSync(join(workDir, 'nx-mk.config.yml'), 'plugins: []\n')
    const found = await findConfigFile(workDir)
    expect(found).toBe(join(workDir, 'nx-mk.config.yml'))
  })

  it('accepts .yaml extension', async () => {
    writeFileSync(join(workDir, 'nx-mk.config.yaml'), 'plugins: []\n')
    const found = await findConfigFile(workDir)
    expect(found).toBe(join(workDir, 'nx-mk.config.yaml'))
  })

  it('throws CONFIG_NOT_FOUND when no config in cwd or parents', async () => {
    // Create an isolated tmp dir with no parents containing the file
    const isolated = mkdtempSync(join(tmpdir(), 'nx-mk-isolated-'))
    try {
      await expect(findConfigFile(isolated)).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' })
    } finally {
      rmSync(isolated, { recursive: true, force: true })
    }
  })
})

describe('loadConfig', () => {
  it('parses a valid YAML file with defaults applied', async () => {
    const cfgPath = join(workDir, 'nx-mk.config.yml')
    writeFileSync(cfgPath, "plugins:\n  - '@nx-mk/plugin-swagger'\nlogLevel: debug\n")
    const cfg = await loadConfig({
      path: cfgPath,
      cwd: workDir,
      runId: makeRunId('r1'),
      subcommand: 'run',
    })
    expect(cfg.plugins).toEqual(['@nx-mk/plugin-swagger'])
    expect(cfg.logLevel).toBe('debug')
    expect(cfg.outputDir).toBe('.nx-mk/runs')
    expect(cfg.configPath).toBe(cfgPath)
    expect(cfg.runId).toBe('r1')
    expect(cfg.subcommand).toBe('run')
  })

  it('applies defaults when fields are omitted', async () => {
    const cfgPath = join(workDir, 'nx-mk.config.yml')
    writeFileSync(cfgPath, 'plugins: []\n')
    const cfg = await loadConfig({
      path: cfgPath,
      cwd: workDir,
      runId: makeRunId('r'),
      subcommand: 'run',
    })
    expect(cfg.logLevel).toBe('info')
    expect(cfg.outputDir).toBe('.nx-mk/runs')
  })

  it('throws CONFIG_INVALID with zod issues on bad schema', async () => {
    const cfgPath = join(workDir, 'nx-mk.config.yml')
    writeFileSync(cfgPath, "plugins:\n  - 'BAD NAME WITH SPACES'\n")
    await expect(
      loadConfig({ path: cfgPath, cwd: workDir, runId: makeRunId('r'), subcommand: 'run' }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  it('CLI overrides > env > file > defaults', async () => {
    const cfgPath = join(workDir, 'nx-mk.config.yml')
    writeFileSync(cfgPath, 'plugins: []\nlogLevel: info\n')
    const cfg = await loadConfig({
      path: cfgPath,
      cwd: workDir,
      runId: makeRunId('r'),
      subcommand: 'run',
      cliOverrides: { logLevel: 'debug' },
      env: { nx_mk_LOG_LEVEL: 'warn' },
    })
    expect(cfg.logLevel).toBe('debug')
    expect(cfg.cliOverrides).toEqual({ logLevel: 'debug' })
    expect(cfg.envOverrides).toEqual({ logLevel: 'warn' })
  })

  it('env overrides config when no CLI override is provided', async () => {
    const cfgPath = join(workDir, 'nx-mk.config.yml')
    writeFileSync(cfgPath, 'plugins: []\nlogLevel: info\n')
    const cfg = await loadConfig({
      path: cfgPath,
      cwd: workDir,
      runId: makeRunId('r'),
      subcommand: 'run',
      env: { nx_mk_LOG_LEVEL: 'debug' },
    })
    expect(cfg.logLevel).toBe('debug')
  })
})

// Suppress unused-import warning for KernelError (re-exported for callers)
void KernelError
