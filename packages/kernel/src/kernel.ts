/**
 * 内核核心 —— createKernel 工厂与 5 阶段生命周期驱动器（本包最重要的文件）
 *
 * 生命周期：loadConfig → resolvePlugins → initPlugins → run → shutdown，
 * 每个阶段前后触发插件的 before/after 钩子。任一阶段抛错即 fail-fast：
 * 在 finally 中统一走 shutdown 收尾，由 CLI 层按错误码映射进程退出码（见 errors.ts）。
 * 每次运行在 .nx-mk/runs/{runId}/ 下产出 kernel.log、error.log、events.jsonl。
 *
 * A1 拆分：阶段驱动机器（transitionPlugin / 钩子捕获 / runPhase）在 kernel-runtime.ts，
 * 本文件持有全部可变闭包状态并经 KernelRuntimeDeps 访问器缝注入 —— 行为零变化。
 */
import { mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from './logger'
import { EventBus } from './event-bus'
import { KernelError, mapErrorCodeToExit } from './errors'
import { createKernelRuntime } from './kernel-runtime'
import type { KernelLoopState } from './kernel-runtime'
import type { KernelAPI, Plugin, PluginContext, RunResult } from './plugin'
import type { GoalResult, KernelState, Phase, ResolvedConfig, RunId } from './types'
import type { Coverage, MissingItem, PluginReport, PluginSignal } from './types'
import { makeRunId, PHASES } from './types'

// 创建内核的入参：configPath 必填；plugins 仅供测试注入，生产环境走配置动态加载
export interface CreateKernelOptions {
  configPath: string
  runId: RunId
  subcommand: 'run' | 'init' | 'doctor'
  cwd?: string
  plugins?: Plugin[]     // for tests; production uses loadPlugins from config
  /** Ruling 5（Task 7 审查）：追加缝 —— 配置插件加载完成后附加的程序化插件实例
   *  （run.ts 代码装配 plugin-playwright 用）；测试注入路径（plugins）同样支持追加。 */
  extraPlugins?: Plugin[]
  /** Ruling 5：从配置 plugins 数组过滤掉的插件包名（防同插件双实例，如代码装配后配置里仍声明）。 */
  excludePluginNames?: string[]
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
  const phaseTimers = new Map<Phase, number>()
  // shutdown 幂等保护：缓存首次调用的 Promise，重复调用直接复用
  let shutdownPromise: Promise<void> | null = null
  // 是否成功跑完前 4 个阶段（决定 finally 中是否执行 shutdown 收尾）
  let runFinished = false

  /** M14：Goal Loop 共享状态（mutable）—— 结构与读写方见 kernel-runtime.ts 的 KernelLoopState */
  const loopState: KernelLoopState = {
    reports: [],
    turn: 0,
    coverage: { total: 0, covered: 0, ratio: 1.0, missing: [] as MissingItem[] } as Coverage,
    idleTurns: 0,
  }

  // 阶段驱动机器（kernel-runtime.ts）：访问器缝保持拆分前的闭包语义
  const runtime = createKernelRuntime({
    opts,
    cwd,
    events,
    logger,
    state,
    loopState,
    phaseTimers,
    getPlugins: () => plugins,
    setPlugins: (next) => { plugins = next },
    getConfig: () => config,
    setConfig: (next) => { config = next },
    isManualShutdown: () => shutdownPromise !== null,
    buildCtx,
  })

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
          await runtime.runPhase(phase)
        }
        runFinished = true
        // spec §3.1 审计链：goal run 的终止原因与覆盖率快照随 RunResult 返回（Task 8 的 run.ts 消费）；
        // 非 goal run 时 state.collectionResult 未填充 → 两字段均为 undefined
        const goalRes: GoalResult | undefined = state.collectionResult ?? undefined
        return {
          runId: opts.runId,
          durationMs: Date.now() - start,
          terminatedBy: goalRes?.terminatedBy,
          coverage: goalRes?.coverage,
        }
      } catch (err) {
        // 记录错误到内核状态；非 KernelError 一律归为 KERNEL_INTERNAL（退出码 5）
        state.error = {
          code: err instanceof KernelError ? err.code : 'KERNEL_INTERNAL',
          message: (err as Error).message,
        }
        const lastPluginError = runtime.getLastPluginError()
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
          await runtime.runPhase('shutdown')
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
        await runtime.runPhase('shutdown')
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
