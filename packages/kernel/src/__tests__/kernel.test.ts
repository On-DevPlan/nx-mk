import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKernel } from '../kernel'
import type { Plugin } from '../plugin'
import { KernelError } from '../errors'

let workDir: string
let configPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-kernel-'))
  configPath = join(workDir, 'nx-mk.config.yml')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function writeConfig(plugins: string[] = []): void {
  const pluginsLine = plugins.length === 0
    ? 'plugins: []\n'
    : `plugins:\n${plugins.map((p) => `  - '${p}'\n`).join('')}`
  writeFileSync(configPath, `${pluginsLine}logLevel: debug\noutputDir: ./.nx-mk/runs\n`)
}

function callsPlugin(): Plugin {
  const calls: string[] = []
  const allHooks = [
    'beforeLoadConfig',
    'afterLoadConfig',
    'beforeResolvePlugins',
    'afterResolvePlugins',
    'beforeInitPlugins',
    'afterInitPlugins',
    'beforeRun',
    'run',
    'afterRun',
    'beforeShutdown',
    'shutdown',
    'afterShutdown',
  ] as const
  const hooks: Plugin['hooks'] = {}
  for (const h of allHooks) {
    hooks[h] = () => {
      calls.push(h)
    }
  }
  return {
    name: '@nx-mk/test-plugin',
    version: '0.1.0',
    hooks,
    __calls: calls, // attached for assertions
  } as Plugin & { __calls: string[] }
}

describe('createKernel', () => {
  it('runs all 5 phases with before/after hooks around each (subcommand=run)', async () => {
    writeConfig()
    const p = callsPlugin()
    const kernel = createKernel({ configPath, runId: 'r1' as never, subcommand: 'run', cwd: workDir, plugins: [p] })
    const result = await kernel.run()
    expect(result.runId).toBe('r1')
    const calls = (p as Plugin & { __calls: string[] }).__calls
    expect(calls).toEqual([
      'beforeLoadConfig',
      'afterLoadConfig',
      'beforeResolvePlugins',
      'afterResolvePlugins',
      'beforeInitPlugins',
      'afterInitPlugins',
      'beforeRun',
      'run',
      'afterRun',
      'beforeShutdown',
      'shutdown',
      'afterShutdown',
    ])
  })

  it('runs all 5 phases regardless of subcommand (init/doctor)', async () => {
    writeConfig()
    for (const sub of ['init', 'doctor'] as const) {
      const p = callsPlugin()
      const kernel = createKernel({ configPath, runId: 'r' as never, subcommand: sub, cwd: workDir, plugins: [p] })
      await kernel.run()
      const calls = (p as Plugin & { __calls: string[] }).__calls
      expect(calls).toContain('beforeLoadConfig')
      expect(calls).toContain('shutdown')
      expect(calls).toContain('afterShutdown')
    }
  })

  it('fails fast when a hook throws, jumps to shutdown, re-throws as PLUGIN_HOOK_FAILED', async () => {
    writeConfig()
    const p: Plugin = {
      name: '@nx-mk/thrower',
      version: '0.1.0',
      hooks: {
        beforeRun: () => {
          throw new Error('boom')
        },
      },
    }
    const calls: string[] = []
    const cleanup: Plugin = {
      name: '@nx-mk/cleanup',
      version: '0.1.0',
      hooks: {
        beforeShutdown: () => calls.push('cleanup-beforeShutdown'),
        shutdown: () => calls.push('cleanup-shutdown'),
      },
    }
    const kernel = createKernel({ configPath, runId: 'r' as never, subcommand: 'run', cwd: workDir, plugins: [p, cleanup] })
    await expect(kernel.run()).rejects.toBeInstanceOf(KernelError)
    expect(calls).toEqual(['cleanup-beforeShutdown', 'cleanup-shutdown'])
  })

  it('runs shutdown hooks in reverse plugin order', async () => {
    writeConfig()
    const order: string[] = []
    const make = (n: string): Plugin => ({
      name: n,
      version: '0.0.0',
      hooks: { shutdown: () => order.push(n) },
    })
    const kernel = createKernel({
      configPath,
      runId: 'r' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [make('a'), make('b'), make('c')],
    })
    await kernel.run()
    expect(order).toEqual(['c', 'b', 'a'])
  })

  it('getSubcommand returns the value passed to createKernel', async () => {
    writeConfig()
    let observed: string | null = null
    const p: Plugin = {
      name: 'p',
      version: '0.0.0',
      hooks: {
        run: ({ kernel }) => {
          observed = kernel.getSubcommand()
        },
      },
    }
    const kernel = createKernel({ configPath, runId: 'r' as never, subcommand: 'doctor', cwd: workDir, plugins: [p] })
    await kernel.run()
    expect(observed).toBe('doctor')
  })

  it('throws CONFIG_NOT_FOUND when config file does not exist', async () => {
    const kernel = createKernel({ configPath: join(workDir, 'nope.yml'), runId: 'r' as never, subcommand: 'run', cwd: workDir, plugins: [] })
    await expect(kernel.run()).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' })
  })

  it('writes events.jsonl under the run directory', async () => {
    writeConfig()
    const kernel = createKernel({ configPath, runId: 'r1' as never, subcommand: 'run', cwd: workDir, plugins: [] })
    await kernel.run()
    const eventsPath = join(workDir, '.nx-mk', 'runs', 'r1', 'events.jsonl')
    const { readFileSync } = await import('node:fs')
    const lines = readFileSync(eventsPath, 'utf8').trim().split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(10) // 5 phase:start + 5 phase:end
  })
})
