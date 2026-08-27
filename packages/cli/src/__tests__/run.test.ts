import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMain } from '../commands/run'

let workDir: string
let configPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-run-test-'))
  configPath = join(workDir, 'nx-mk.config.yml')
  writeFileSync(configPath, 'plugins: []\nlogLevel: info\n')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('runMain', () => {
  it('runs the kernel lifecycle and prints the success message', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runMain({ configPath, runId: 'test_run_1' })
    const output = consoleLog.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('✔ Run test_run_1 completed')
    expect(output).toContain('.nx-mk/runs/test_run_1')
    consoleLog.mockRestore()
  })

  it('throws KernelError CONFIG_NOT_FOUND when configPath does not exist', async () => {
    await expect(
      runMain({ configPath: join(workDir, 'does-not-exist.yml'), runId: 'r' })
    ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' })
  })
})
