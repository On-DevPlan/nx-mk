import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../commands/init'

let workDir: string
let configPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-init-test-'))
  configPath = join(workDir, 'nx-mk.config.yml')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('runInit', () => {
  it('creates nx-mk.config.yml + .nx-mk/runs/ when config does not exist', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runInit({ configPath })
    expect(existsSync(configPath)).toBe(true)
    expect(existsSync(join(workDir, '.nx-mk', 'runs'))).toBe(true)
    const content = readFileSync(configPath, 'utf8')
    expect(content).toContain('plugins:')
    expect(content).toContain("'@nx-mk/plugin-swagger'")
    expect(content).toContain('logLevel: info')
    expect(content).toContain('outputDir:')
    consoleLog.mockRestore()
  })

  it('logs already-exists message and does not overwrite when config exists', async () => {
    writeFileSync(configPath, '# user-custom-config\nplugins: []\n')
    const original = readFileSync(configPath, 'utf8')
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runInit({ configPath })
    expect(readFileSync(configPath, 'utf8')).toBe(original) // unchanged
    const calls = consoleLog.mock.calls.map((c) => String(c[0])).join('\n')
    expect(calls).toContain('already exists')
    consoleLog.mockRestore()
  })

  it('exercises the kernel lifecycle and creates an init run directory', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runInit({ configPath })
    expect(existsSync(join(workDir, '.nx-mk', 'runs', 'init'))).toBe(true)
    consoleLog.mockRestore()
  })
})
