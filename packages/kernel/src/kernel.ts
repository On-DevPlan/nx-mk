/**
 * 内核核心 —— createKernel 工厂与 5 阶段生命周期驱动器（本包最重要的文件）
 *
 * 生命周期：loadConfig → resolvePlugins → initPlugins → run → shutdown，
 * 每个阶段前后触发插件的 before/after 钩子。任一阶段抛错即 fail-fast：
 * 在 finally 中统一走 shutdown 收尾，由 CLI 层按错误码映射进程退出码（见 errors.ts）。
 * 每次运行在 .nx-mk/runs/{runId}/ 下产出 kernel.log、error.log、events.jsonl。
 */
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from './logger'
import { EventBus } from './event-bus'
import { runHook, runHooksForPhase, hookNameForPhase } from './hooks'
import { loadPlugins, resolveDependencies } from './plugin-registry'
import { runGoalLoop } from './goal-loop'
import { KernelError, mapErrorCodeToExit } from './errors'
import type { KernelAPI, Plugin, PluginContext, RunResult } from './plugin'
import type { KernelState, Phase, PluginWorkerState, ResolvedConfig, RunId } from './types'
import type { Coverage, MissingItem, PluginReport, PluginSignal } from './types'
import { assertNever, makePluginName, makeRunId, PHASES } from './types'

// 创建内核的入参：configPath 必填；plugins 仅供测试注入，生产环境走配置动态加载
export interface CreateKernelOptions {
  configPath: string
  runId: RunId
  subcommand: 'run' | 'init' | 'doctor'
  cwd?: string
  plugins?: Plugin[]     // for tests; production uses loadPlugins from config
}

/**
 * 内核工厂：创建运行目录、事件总线、日志器与初始状态，返回 KernelAPI。
 * 生命周期由调用方通过 api.run() 显式驱动，工厂本身不执行任何阶段。
 */
export function createKernel(opts: CreateKernelOptions): KernelAPI {
  const cwd = opts.cwd ?? process.cwd()
  // 本次运行的产物目录：.nx-mk/runs/{runId}/
  const runDir = join(cwd, '.nx-mk', 'runs', opts.runId)
  mkdirSync(runDir, { recursive: true })

  // 事件持久化流：以追加模式把每个事件写为一行 JSON（events.jsonl）
  const eventsFile = join(runDir, 'events.jsonl')
  const eventsStream = createWriteStream(eventsFile, { flags: 'a' })
  const events = new EventBus({ persistTo: eventsStream })

  // 内核日志器：NDJSON 写 kernel.log，error 级别额外镜像到 error.log
  const logger = createLogger({
    runId: opts.runId,
    logLevel: 'info',
    logFile: join(runDir, 'kernel.log'),
    errorFile: join(runDir, 'error.log'),
  })

  // 内核可观测状态快照（外部经 getState() 读取其浅拷贝）
  const state: KernelState = {
    runId: opts.runId,
    currentPhase: null,
    startedAt: new Date().toISOString(),
    loadedPlugins: [],
    // M1：每个插件的 lifecycle 状态（key = PluginName）
    pluginStates: new Map(),
  }

  // —— 闭包内的可变运行时状态（随生命周期推进而更新）——
  // 插件列表：测试可直接注入；生产由 resolvePlugins 阶段从配置动态加载
  let plugins: Plugin[] = opts.plugins ?? []
  // 最终配置：loadConfig 阶段填充，此前为 null
  let config: ResolvedConfig | null = null
  // 各阶段开始时间戳，用于计算 phase:end 事件的 durationMs
  let phaseTimers = new Map<Phase, number>()
  // shutdown 幂等保护：缓存首次调用的 Promise，重复调用直接复用
  let shutdownPromise: Promise<void> | null = null
  // 是否成功跑完前 4 个阶段（决定 finally 中是否执行 shutdown 收尾）
  let runFinished = false
  // 最近一次插件钩子失败的「插件名 + 钩子名 + 原始错误」，供 catch 中发出 plugin:error 事件
  let lastPluginError: {
    name: string
    hook: string
    error: { message: string; stack?: string }
  } | null = null

  /**
   * M14：Goal Loop 共享状态（mutable）。run 阶段触发 Goal Loop 时填充。
   * buildCtx 的 emit/emitSignal/getTurn/getCoverage 方法读/写这里。
   * 中文：把循环状态集中在 createKernel 闭包内，避免与外部状态耦合。
   */
  const loopState = {
    reports: [] as PluginReport[],
    turn: 0,
    coverage: { total: 0, covered: 0, ratio: 1.0, missing: [] as MissingItem[] } as Coverage,
    idleTurns: 0,
  }

  /**
   * 转移插件状态并发出 plugin:state-change 事件（M1）。
   * 若目标状态与当前状态一致则跳过（避免冗余事件）。
   * 中文：集中所有状态转移，便于未来加入 invariant 检查与日志。
   *
   * M5 增强：用 switch + assertNever 显式列举 PluginWorkerState 所有 kind，
   * 编译期保证新增状态时所有分支都会被检查。
   */
  function transitionPlugin(
    name: string,
    to: PluginWorkerState,
  ): void {
    const key = makePluginName(name)
    const previous = state.pluginStates.get(key)
    const fromKind: PluginWorkerState['kind'] = previous?.kind ?? 'pending'
    const toKind = to.kind
    state.pluginStates.set(key, to)
    // 旧字段同步：loadedPlugins 记录"已加载"集合（active 之前的转移都算加载）
    if (toKind === 'active' && !state.loadedPlugins.includes(name)) {
      state.loadedPlugins.push(name)
    }
    if (fromKind === toKind) return
    // 构造事件载荷：error 字段仅 failed 状态携带
    const baseEvent = {
      type: 'plugin:state-change' as const,
      name,
      from: fromKind,
      to: toKind,
      timestamp: new Date().toISOString(),
    }
    let event: typeof baseEvent & { error?: { code: string; message: string } }
    switch (toKind) {
      case 'active':
      case 'done':
      case 'pending':
      case 'loading':
      case 'unloading':
      case 'disposed':
        event = baseEvent
        break
      case 'failed':
        event = { ...baseEvent, error: to.error }
        break
      default:
        assertNever(toKind)
    }
    events.emit(event)
  }

  // 中文说明：带错误捕获的钩子批量执行器。除了透传 fail-fast 语义外，
  // 额外记录「哪个插件的哪个钩子」失败及原始错误，供 api.run() 顶层 catch
  // 发出 plugin:error 事件并写结构化 error.log。
  /**
   * Wrapper around runHooksForPhase that captures which plugin + hook failed,
   * so the top-level catch in api.run() can emit a `plugin:error` event
   * and write a structured line to error.log per spec §3.4 + §5.1.
   */
  async function runHooksForPhaseWithCapture(
    phase: Phase,
    timing: 'before' | 'after',
    phasePlugins: Plugin[],
    ctx: PluginContext,
  ): Promise<void> {
    const name = hookNameForPhase(phase, timing)
    // 逐个插件串行执行；捕获后先记录失败详情再原样抛出（fail-fast）
    for (const plugin of phasePlugins) {
      try {
        await runHook(name, plugin, ctx)
      } catch (err) {
        // 中文：优先取被包装前的原始错误（cause）的信息与堆栈，
        // 让下游看到插件真实报错（如 "hook-boom"）而非外层包装文案
        // Prefer the inner cause's message (the original plugin error)
        // so downstream consumers see "hook-boom", not the wrapper
        // "Plugin 'p-thrower' hook 'run' failed: hook-boom".
        const innerMessage =
          err instanceof KernelError && err.cause instanceof Error
            ? err.cause.message
            : (err as Error).message
        const innerStack =
          err instanceof KernelError && err.cause instanceof Error
            ? err.cause.stack
            : err instanceof Error
              ? err.stack
              : undefined
        lastPluginError = {
          name: plugin.name,
          hook: name,
          error: {
            message: innerMessage,
            stack: innerStack,
          },
        }
        // M1：钩子失败时把插件状态置为 failed
        transitionPlugin(plugin.name, {
          kind: 'failed',
          error: {
            code: err instanceof KernelError ? err.code : 'PLUGIN_HOOK_FAILED',
            message: innerMessage,
          },
          failedAt: new Date().toISOString(),
        })
        throw err
      }
    }
  }

  /**
   * 执行单个阶段：更新内核状态 → 发 phase:start 事件 → 按阶段分发插件钩子
   * → 计算耗时并发 phase:end 事件。各阶段的具体行为见下方分支注释。
   */
  async function runPhase(phase: Phase): Promise<void> {
    state.currentPhase = phase
    phaseTimers.set(phase, Date.now())
    events.emit({ type: 'phase:start', phase, timestamp: new Date().toISOString() })

    // —— 阶段 1：loadConfig —— 读取并校验 nx-mk.config.yml
    if (phase === 'loadConfig') {
      await runHooksForPhaseWithCapture(phase, 'before', plugins, buildCtx())
      // 配置文件不存在直接抛 CONFIG_NOT_FOUND（退出码 2）
      if (!existsSync(opts.configPath)) {
        throw new KernelError('CONFIG_NOT_FOUND', `Config file not found: ${opts.configPath}`)
      }
      // 动态 import 打破 kernel ↔ config 的循环依赖（config 包反向依赖 kernel 的类型与错误类）
      const { loadConfig } = await import('@nx-mk/config')
      config = await loadConfig({ path: opts.configPath, cwd, runId: opts.runId, subcommand: opts.subcommand })
      await runHooksForPhaseWithCapture(phase, 'after', plugins, buildCtx())
    } else if (phase === 'resolvePlugins') {
      // —— 阶段 2：resolvePlugins —— 按配置的 plugins 列表动态加载 npm 插件包
      await runHooksForPhaseWithCapture(phase, 'before', plugins, buildCtx())
      // 测试注入了 plugins 则跳过加载，否则走 plugin-registry 的动态 import 链路
      if (opts.plugins === undefined) {
        plugins = await loadPlugins(config!.plugins, { cwd, config: config! })
        // 每加载成功一个插件：发 plugin:loaded 事件并写入内核状态
        for (const p of plugins) {
          events.emit({ type: 'plugin:loaded', name: p.name, version: p.version })
          state.loadedPlugins.push(p.name)
          // M1：每个加载成功的插件立即置为 active
          transitionPlugin(p.name, { kind: 'active', activatedAt: new Date().toISOString() })
        }
      } else {
        // 测试路径：注入的 plugins 也走 active 转移以保证 pluginStates 与 loadedPlugins 一致
        for (const p of plugins) {
          if (!state.loadedPlugins.includes(p.name)) {
            state.loadedPlugins.push(p.name)
          }
          transitionPlugin(p.name, { kind: 'active', activatedAt: new Date().toISOString() })
        }
      }
      await runHooksForPhaseWithCapture(phase, 'after', plugins, buildCtx())
    } else if (phase === 'initPlugins') {
      // —— 阶段 3：initPlugins —— 校验插件依赖 + 预留的插件初始化阶段
      await runHooksForPhaseWithCapture(phase, 'before', plugins, buildCtx())
      // M3：检查所有插件的 inject 依赖是否被 provide 满足
      // 不满足时抛 PLUGIN_DEPENDENCY_MISSING（退出码 7），fail-fast
      resolveDependencies(plugins)
      // kernel default: no-op (plugin instance is already constructed)
      // 中文：内核默认无动作（插件对象在工厂调用时已构造完成），仅触发前后钩子
      await runHooksForPhaseWithCapture(phase, 'after', plugins, buildCtx())
    } else if (phase === 'run') {
      // —— 阶段 4：run —— 主工作阶段，触发 beforeRun 钩子后运行 Goal Loop（M14），
      // 最后触发 afterRun 钩子。Goal Loop 仅在 config.goal 定义时启用，否则保持
      // 原 push-based 行为（向后兼容）。
      await runHooksForPhaseWithCapture(phase, 'before', plugins, buildCtx())
      if (config?.goal) {
        // Goal Loop 路径：构建共享循环状态 + AbortController
        // 注意：initial coverage 默认全未覆盖（manifest 接入后由 manifest 计算）
        // 当前用 placeholder 确保 loop 至少跑一轮（demo 模式）。
        loopState.reports = []
        loopState.turn = 0
        loopState.coverage = {
          total: 1,
          covered: 0,
          ratio: 0,
          missing: [{ kind: 'field', fieldId: '__placeholder__' }],
        }
        loopState.idleTurns = 0
        const goalAbort = new AbortController()
        // 触发手动 shutdown 时同步终止 goal loop
        if (shutdownPromise) goalAbort.abort()
        try {
          const goalResult = await runGoalLoop({
            plugins,
            goal: config.goal,
            initialCoverage: loopState.coverage,
            ctx: buildCtx(),
            signal: goalAbort.signal,
          })
          state.collectionResult = goalResult
          // 发出 goal:met 或 goal:unmet 事件
          if (goalResult.kind === 'met') {
            events.emit({
              type: 'goal:met',
              coverage: goalResult.coverage,
              turns: goalResult.turns,
              durationMs: goalResult.durationMs,
            })
          } else {
            events.emit({
              type: 'goal:unmet',
              reason:
                goalResult.terminatedBy === 'max-turns' ||
                goalResult.terminatedBy === 'idle' ||
                goalResult.terminatedBy === 'timeout' ||
                goalResult.terminatedBy === 'all-failed'
                  ? goalResult.terminatedBy
                  : 'idle',
              coverage: goalResult.coverage,
              turns: goalResult.turns,
            })
          }
        } catch (err) {
          // Goal Loop 内部错误：包装为 KERNEL_INTERNAL，让上层 fail-fast 处理
          throw new KernelError(
            'KERNEL_INTERNAL',
            `Goal loop failed: ${(err as Error).message}`,
            err,
          )
        }
      }
      await runHooksForPhaseWithCapture(phase, 'after', plugins, buildCtx())
    } else if (phase === 'shutdown') {
      // —— 阶段 5：shutdown —— 关停收尾，插件按加载的逆序执行
      // Reverse order
      // 中文：逆序保证后加载的插件先清理，避免依赖反向残留
      const reversed = [...plugins].reverse()
      // Per spec §3.3, shutdown hook errors only log (don't throw)
      // 中文：shutdown 钩子异常只记录不抛出，保证其余插件也能完成收尾
      const safeRun = async (timing: 'before' | 'after') => {
        try {
          await runHooksForPhase(phase, timing, reversed, buildCtx())
        } catch (err) {
          logger.error('shutdown hook error (suppressed)', { phase, timing, err: (err as Error).message })
        }
      }
      await safeRun('before')
      await safeRun('after')
    }

    // 计算阶段耗时并发出结束事件（durationMs 供性能分析）
    const durationMs = Date.now() - (phaseTimers.get(phase) ?? Date.now())
    events.emit({ type: 'phase:end', phase, durationMs })
  }

  /**
   * 构造传给插件钩子的上下文（config + logger + events + kernel 句柄）。
   * config 尚未加载时（loadConfig 的 before 钩子）使用占位配置，保证 ctx 字段可用。
   *
   * M14：注入 Goal Loop 报告/信号 API，直接读写 loopState。
   */
  function buildCtx(): PluginContext {
    const goalCtx = {
      emitReport: (report: PluginReport): void => {
        loopState.reports.push(report)
      },
      emitSignal: (_signal: PluginSignal): void => {
        /* signal 处理留作未来 milestone（M14 当前仅记录 report） */
      },
      getTurn: (): number => loopState.turn,
      getCoverage: (): Coverage => loopState.coverage,
      getMissing: (): MissingItem[] => loopState.coverage.missing,
    }
    if (!config) {
      // During loadConfig's before-hooks, config is not yet loaded.
      // Build a placeholder ResolvedConfig so plugin hooks receive a usable ctx.
      // 占位 ctx 供 loadConfig 的 before-hook 使用（此时 config 还未填充）
      const placeholder: ResolvedConfig = {
        configPath: opts.configPath,
        runId: opts.runId,
        envOverrides: {},
        cliOverrides: {},
        subcommand: opts.subcommand,
        plugins: [],
        logLevel: 'info',
        outputDir: '.nx-mk/runs',
      }
      return { config: placeholder, logger, events, kernel: api, cwd, ...goalCtx }
    }
    return { config, logger, events, kernel: api, cwd, ...goalCtx }
  }

  // 对外暴露的内核 API（同时作为 kernel 句柄注入给插件钩子）
  const api: KernelAPI = {
    async run(): Promise<RunResult> {
      const start = Date.now()
      // 前 4 个阶段顺序执行；shutdown 留给 finally 统一触发
      // 顺序由 PHASES 常量驱动（types.ts）作为单一来源，避免与 runPhase 分支重复
      const ordered = PHASES.filter((p) => p !== 'shutdown')
      try {
        for (const phase of ordered) {
          await runPhase(phase)
        }
        runFinished = true
        return { runId: opts.runId, durationMs: Date.now() - start }
      } catch (err) {
        // 记录错误到内核状态；非 KernelError 一律归为 KERNEL_INTERNAL（退出码 5）
        state.error = {
          code: err instanceof KernelError ? err.code : 'KERNEL_INTERNAL',
          message: (err as Error).message,
        }
        if (lastPluginError) {
          // 中文：错误来源是插件钩子时——
          // 先发 plugin:error 再发 kernel:error（spec §3.4 的顺序要求）；
          // 同时把结构化错误行写入 error.log（spec §5.1），
          // 保证即使 logLevel=silent，磁盘上也有可供事后排查的记录。
          // Per spec §3.4: emit plugin:error BEFORE kernel:error.
          // Per spec §5.1: write a structured error line to error.log so it
          // exists on disk for postmortem tools even when logLevel=silent.
          const originalMessage =
            (err instanceof KernelError && err.cause instanceof Error)
              ? err.cause.message
              : (err as Error).message
          logger.error('plugin hook failed', {
            phase: state.currentPhase ?? 'loadConfig',
            plugin: lastPluginError.name,
            hook: lastPluginError.hook,
            error: new Error(`Plugin hook failed: ${originalMessage}`),
          })
          events.emit({
            type: 'plugin:error',
            name: lastPluginError.name,
            hook: lastPluginError.hook,
            phase: state.currentPhase ?? 'loadConfig',
            error: lastPluginError.error,
          })
        }
        // 内核级错误事件（无论错误来源都发出）
        events.emit({
          type: 'kernel:error',
          phase: state.currentPhase ?? 'loadConfig',
          error: { message: (err as Error).message },
        })
        // 向上抛出，由 CLI 顶层 catch 映射退出码
        throw err
      } finally {
        // 成功或失败都执行 shutdown 收尾，并落盘日志、关闭事件流
        if (runFinished || state.error) {
          await runPhase('shutdown')
          await logger.flush()
          await new Promise<void>((resolve) => eventsStream.end(() => resolve()))
        }
      }
    },
    // 手动关停入口（幂等：首次调用后缓存 Promise，重复调用直接复用）
    async shutdown(reason?: string): Promise<void> {
      if (shutdownPromise) return shutdownPromise
      shutdownPromise = (async () => {
        logger.info('entering shutdown', { reason: reason ?? 'manual' })
        await runPhase('shutdown')
        await logger.flush()
        await new Promise<void>((resolve) => eventsStream.end(() => resolve()))
      })()
      return shutdownPromise
    },
    // 只读访问器：返回状态浅拷贝 / 运行 ID / 子命令（无副作用）
    // M1：pluginStates Map 返回浅拷贝的新 Map，避免外部直接修改闭包内状态
    getState: () => ({ ...state, pluginStates: new Map(state.pluginStates) }),
    getRunId: () => opts.runId,
    getSubcommand: () => opts.subcommand,
  }

  return api
}

// Re-export the exit mapper for CLI consumers
// 中文：重新导出退出码映射与 RunId 构造器，方便 CLI 直接从 kernel 包取用
export { mapErrorCodeToExit }
// Re-export makeRunId so callers can build one
export { makeRunId }
