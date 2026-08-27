import { describe, it, expect, vi } from 'vitest'
import { runHook, runHooksForPhase } from '../hooks'
import { KernelError } from '../errors'
import type { Plugin, PluginContext, HookName } from '../plugin'
import type { ResolvedConfig, RunId, KernelState } from '../types'
import type { Logger } from '../logger'
import type { EventBus } from '../event-bus'
import type { KernelAPI } from '../plugin'

function mkCtx(): PluginContext {
  const dummyState: KernelState = { runId: 'r' as RunId, currentPhase: null, startedAt: '', loadedPlugins: [] }
  const api: KernelAPI = {
    run: async () => ({ runId: 'r' as RunId, durationMs: 0 }),
    shutdown: async () => {},
    getState: () => dummyState,
    getRunId: () => 'r' as RunId,
    getSubcommand: () => 'run',
  }
  return {
    config: {} as ResolvedConfig,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: async () => {} },
    events: { emit: vi.fn(), on: () => () => {}, off: vi.fn(), removeAllListeners: vi.fn() } as unknown as EventBus,
    kernel: api,
  }
}

function mkPlugin(name: string, hooks: Plugin['hooks']): Plugin {
  return { name, version: '0.0.0', hooks }
}

describe('runHook', () => {
  it('is a no-op when the plugin does not implement the hook', async () => {
    const plugin = mkPlugin('p', {})
    await expect(runHook('afterRun', plugin, mkCtx())).resolves.toBeUndefined()
  })

  it('awaits the handler before returning', async () => {
    let resolved = false
    const plugin = mkPlugin('p', {
      afterRun: async () => {
        await new Promise((r) => setTimeout(r, 5))
        resolved = true
      },
    })
    await runHook('afterRun', plugin, mkCtx())
    expect(resolved).toBe(true)
  })

  it('wraps a sync throw into a KernelError PLUGIN_HOOK_FAILED', async () => {
    const plugin = mkPlugin('p', {
      afterRun: () => {
        throw new Error('original')
      },
    })
    await expect(runHook('afterRun', plugin, mkCtx())).rejects.toMatchObject({
      name: 'KernelError',
      code: 'PLUGIN_HOOK_FAILED',
      message: expect.stringContaining("Plugin 'p' hook 'afterRun' failed") as unknown as string,
    })
  })

  it('wraps a rejected promise into PLUGIN_HOOK_FAILED', async () => {
    const plugin = mkPlugin('p', {
      async beforeRun() {
        throw new Error('async boom')
      },
    })
    await expect(runHook('beforeRun', plugin, mkCtx())).rejects.toBeInstanceOf(KernelError)
  })
})

describe('runHooksForPhase', () => {
  it('runs before → after for each plugin in order', async () => {
    const calls: string[] = []
    const plugins = [
      mkPlugin('a', {
        beforeRun: () => {
          calls.push('a.beforeRun')
        },
        afterRun: () => {
          calls.push('a.afterRun')
        },
      }),
      mkPlugin('b', {
        beforeRun: () => {
          calls.push('b.beforeRun')
        },
        afterRun: () => {
          calls.push('b.afterRun')
        },
      }),
    ]
    await runHooksForPhase('run', 'before', plugins, mkCtx())
    await runHooksForPhase('run', 'after', plugins, mkCtx())
    expect(calls).toEqual([
      'a.beforeRun',
      'b.beforeRun',
      'a.afterRun',
      'b.afterRun',
    ])
  })

  it('fails fast: stops on first throw and re-throws', async () => {
    const calls: string[] = []
    const plugins = [
      mkPlugin('a', {
        beforeRun: () => {
          calls.push('a.beforeRun')
          throw new Error('a-broke')
        },
      }),
      mkPlugin('b', {
        beforeRun: () => {
          calls.push('b.beforeRun')
        },
      }),
    ]
    await expect(runHooksForPhase('run', 'before', plugins, mkCtx())).rejects.toBeInstanceOf(KernelError)
    // b.beforeRun should NOT have been called (fail-fast)
    expect(calls).toEqual(['a.beforeRun'])
  })

  it('skips plugins that do not implement the hook', async () => {
    const calls: string[] = []
    const plugins = [
      mkPlugin('a', { afterRun: () => calls.push('a') }),
      mkPlugin('b', {}),  // no afterRun hook
      mkPlugin('c', { afterRun: () => calls.push('c') }),
    ]
    await runHooksForPhase('run', 'after', plugins, mkCtx())
    expect(calls).toEqual(['a', 'c'])
  })
})

// Re-export for typing completeness
const _types: HookName[] = ['beforeRun', 'afterRun']
void _types
