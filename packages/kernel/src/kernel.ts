import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from './logger'
import { EventBus } from './event-bus'
import { runHooksForPhase } from './hooks'
import { loadPlugins } from './plugin-registry'
import { KernelError, mapErrorCodeToExit } from './errors'
import type { KernelAPI, Plugin, PluginContext, RunResult } from './plugin'
import type { KernelState, Phase, ResolvedConfig, RunId } from './types'
import { makeRunId } from './types'

export interface CreateKernelOptions {
  configPath: string
  runId: RunId
  subcommand: 'run' | 'init' | 'doctor'
  cwd?: string
  plugins?: Plugin[]     // for tests; production uses loadPlugins from config
}

export function createKernel(opts: CreateKernelOptions): KernelAPI {
  const cwd = opts.cwd ?? process.cwd()
  const runDir = join(cwd, '.nx-mk', 'runs', opts.runId)
  mkdirSync(runDir, { recursive: true })

  const eventsFile = join(runDir, 'events.jsonl')
  const eventsStream = createWriteStream(eventsFile, { flags: 'a' })
  const events = new EventBus({ persistTo: eventsStream })

  const logger = createLogger({
    runId: opts.runId,
    logLevel: 'info',
    logFile: join(runDir, 'kernel.log'),
    errorFile: join(runDir, 'error.log'),
  })

  const state: KernelState = {
    runId: opts.runId,
    currentPhase: null,
    startedAt: new Date().toISOString(),
    loadedPlugins: [],
  }

  let plugins: Plugin[] = opts.plugins ?? []
  let config: ResolvedConfig | null = null
  let phaseTimers = new Map<Phase, number>()
  let shutdownPromise: Promise<void> | null = null
  let runFinished = false

  async function runPhase(phase: Phase): Promise<void> {
    state.currentPhase = phase
    phaseTimers.set(phase, Date.now())
    events.emit({ type: 'phase:start', phase, timestamp: new Date().toISOString() })

    if (phase === 'loadConfig') {
      await runHooksForPhase(phase, 'before', plugins, buildCtx())
      if (!existsSync(opts.configPath)) {
        throw new KernelError('CONFIG_NOT_FOUND', `Config file not found: ${opts.configPath}`)
      }
      const { loadConfig } = await import('@nx-mk/config')
      config = await loadConfig({ path: opts.configPath, cwd, runId: opts.runId, subcommand: opts.subcommand })
      await runHooksForPhase(phase, 'after', plugins, buildCtx())
    } else if (phase === 'resolvePlugins') {
      await runHooksForPhase(phase, 'before', plugins, buildCtx())
      if (opts.plugins === undefined) {
        plugins = await loadPlugins(config!.plugins, { cwd })
        for (const p of plugins) {
          events.emit({ type: 'plugin:loaded', name: p.name, version: p.version })
          state.loadedPlugins.push(p.name)
        }
      }
      await runHooksForPhase(phase, 'after', plugins, buildCtx())
    } else if (phase === 'initPlugins') {
      await runHooksForPhase(phase, 'before', plugins, buildCtx())
      // kernel default: no-op (plugin instance is already constructed)
      await runHooksForPhase(phase, 'after', plugins, buildCtx())
    } else if (phase === 'run') {
      await runHooksForPhase(phase, 'before', plugins, buildCtx())
      await runHooksForPhase(phase, 'main', plugins, buildCtx())
      await runHooksForPhase(phase, 'after', plugins, buildCtx())
    } else if (phase === 'shutdown') {
      // Reverse order
      const reversed = [...plugins].reverse()
      await runHooksForPhase(phase, 'before', reversed, buildCtx())
      await runHooksForPhase(phase, 'main', reversed, buildCtx())
      await runHooksForPhase(phase, 'after', reversed, buildCtx())
    }

    const durationMs = Date.now() - (phaseTimers.get(phase) ?? Date.now())
    events.emit({ type: 'phase:end', phase, durationMs })
  }

  function buildCtx(): PluginContext {
    if (!config) throw new KernelError('KERNEL_INTERNAL', 'ctx accessed before loadConfig')
    return { config, logger, events, kernel: api }
  }

  const api: KernelAPI = {
    async run(): Promise<RunResult> {
      const start = Date.now()
      const ordered: Phase[] = ['loadConfig', 'resolvePlugins', 'initPlugins', 'run']
      try {
        for (const phase of ordered) {
          await runPhase(phase)
        }
        runFinished = true
        return { runId: opts.runId, durationMs: Date.now() - start }
      } catch (err) {
        state.error = {
          code: err instanceof KernelError ? err.code : 'KERNEL_INTERNAL',
          message: (err as Error).message,
        }
        events.emit({
          type: 'kernel:error',
          phase: state.currentPhase ?? 'loadConfig',
          error: { message: (err as Error).message },
        })
        await safeShutdown()
        throw err
      } finally {
        if (runFinished || state.error) {
          await runPhase('shutdown')
          await logger.flush()
          eventsStream.end()
        }
      }
    },
    async shutdown(reason?: string): Promise<void> {
      if (shutdownPromise) return shutdownPromise
      shutdownPromise = (async () => {
        logger.info('entering shutdown', { reason: reason ?? 'manual' })
        await runPhase('shutdown')
        await logger.flush()
        eventsStream.end()
      })()
      return shutdownPromise
    },
    getState: () => ({ ...state }),
    getRunId: () => opts.runId,
    getSubcommand: () => opts.subcommand,
  }

  async function safeShutdown(): Promise<void> {
    try {
      const reversed = [...plugins].reverse()
      // Per spec §3.3, shutdown hooks use isolated try/catch.
      const runSafe = async (phase: Phase, timing: 'before' | 'main' | 'after') => {
        try {
          await runHooksForPhase(phase, timing, reversed, buildCtx())
        } catch (err) {
          logger.error('shutdown hook error (suppressed)', { phase, timing, err: (err as Error).message })
        }
      }
      await runSafe('shutdown', 'before')
      await runSafe('shutdown', 'main')
      await runSafe('shutdown', 'after')
    } catch (err) {
      logger.error('safeShutdown outer failure (suppressed)', { err: (err as Error).message })
    }
  }

  return api
}

// Re-export the exit mapper for CLI consumers
export { mapErrorCodeToExit }
// Re-export makeRunId so callers can build one
export { makeRunId }
