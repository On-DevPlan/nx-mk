import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctor } from '../commands/doctor'

let workDir: string
let logs: string[]

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-doctor-'))
  logs = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
  // Spy on process.exit globally so vitest's "unexpectedly called" check
  // doesn't fire, and tests that need exit-called can assert on the throw.
  vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit-called')
  }) as never)
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('runDoctor', () => {
  it('prints ✔ for Node version >= 20', async () => {
    await expect(
      runDoctor({ configPath: undefined, runId: 'doctor' }),
    ).rejects.toThrow('exit-called')
    const joined = logs.join('\n')
    expect(joined).toMatch(/✔ Node\.js >= 20/)
  })

  it('reports missing config and exits 2', async () => {
    await expect(
      runDoctor({ configPath: undefined, runId: 'doctor' }),
    ).rejects.toThrow('exit-called')
    const joined = logs.join('\n')
    expect(joined).toMatch(/✖ nx-mk\.config\.yml/)
  })

  it('reports all checks ✔ when config + .nx-mk + plugin all valid', async () => {
    writeFileSync(join(workDir, 'nx-mk.config.yml'), "plugins:\n  - '@nx-mk/plugin-swagger'\n")
    mkdirSync(join(workDir, '.nx-mk'), { recursive: true })
    await runDoctor({ configPath: join(workDir, 'nx-mk.config.yml'), runId: 'doctor' })
    const joined = logs.join('\n')
    expect(joined).toMatch(/✔ Node\.js >= 20/)
    expect(joined).toMatch(/✔ nx-mk\.config\.yml/)
    expect(joined).toMatch(/✔ \.nx-mk\/ writable/)
    expect(joined).toMatch(/✔ plugins loadable/)
  })
})
