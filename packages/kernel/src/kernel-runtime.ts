/**
 * 内核运行时 —— 阶段驱动机器（A1 拆分自 kernel.ts，行为零变化）
 *
 * 职责：transitionPlugin 状态转移、带错误捕获的钩子批量执行器、5 阶段 runPhase 驱动。
 * 可变闭包状态（plugins / config / loopState / shutdown 标志）由 createKernel 持有，
 * 经 KernelRuntimeDeps 的访问器缝注入 —— 语义与拆分前的单闭包完全一致。
 * 生命周期说明与 fail-fast 语义见 kernel.ts 头注释。
 */
import { existsSync } from 'node:fs'
import { runHook, runHooksForPhase, hookNameForPhase } from './hooks'
import { loadPlugins, resolveDependencies } from './plugin-registry'
import { runGoalLoop } from './goal-loop'
import { readInitialCoverageFromManifest } from './initial-coverage'
import { KernelError } from './errors'
import { buildPluginsManifest, writePluginsManifest } from './plugins-manifest.js'
import type { EventBus } from './event-bus'
import type { Logger } from './logger'
import type { CreateKernelOptions } from './kernel'
import type { KernelAPI, Plugin, PluginContext } from './plugin'
import type { Coverage, KernelState, MissingItem, Phase, PluginReport, PluginSignal, PluginWorkerState, ResolvedConfig } from './types'
import { assertNever, makePluginName } from './types'

/** M14：Goal Loop 共享状态（mutable）。run 阶段触发 Goal Loop 时填充。
 *  buildCtx 的 emit/emitSignal/getTurn/getCoverage 方法读/写这里。 */
export interface KernelLoopState {
  reports: PluginReport[]
  turn: number
  coverage: Coverage
  idleTurns: number
}

/** 最近一次插件钩子失败的「插件名 + 钩子名 + 原始错误」，供 api.run() 顶层 catch 发出 plugin:error 事件 */
export interface LastPluginError {
  name: string
  hook: string
  error: { message: string; stack?: string }
}

/** runtime 依赖缝：createKernel 装配的可变状态与基础设施句柄（访问器保持闭包语义） */
export interface KernelRuntimeDeps {
  opts: CreateKernelOptions
  cwd: string
  events: EventBus
  logger: Logger
  state: KernelState
  loopState: KernelLoopState
  // 各阶段开始时间戳，用于计算 phase:end 事件的 durationMs
  phaseTimers: Map<Phase, number>
  // 插件列表：测试可直接注入；生产由 resolvePlugins 阶段从配置动态加载
  getPlugins: () => Plugin[]
  setPlugins: (plugins: Plugin[]) => void
  // 最终配置：loadConfig 阶段填充，此前为 null
  getConfig: () => ResolvedConfig | null
  setConfig: (config: ResolvedConfig) => void
  // 手动 shutdown 已触发（shutdownPromise 非空）→ Goal Loop 同步中止
  isManualShutdown: () => boolean
  // 构造 PluginContext（依赖 api 句柄，由 kernel.ts 提供闭包）
  buildCtx: () => PluginContext
}

/** runtime 产物：阶段驱动器 + 顶层 catch 所需的插件错误详情 */
export interface KernelRuntime {
  runPhase(phase: Phase): Promise<void>
  getLastPluginError(): LastPluginError | null
}

/**
 * 阶段驱动机器工厂：接收 createKernel 装配的依赖缝，返回 runPhase 驱动器。
 * 不执行任何阶段 —— 执行节奏仍由 kernel.ts 的 api.run() 控制。
 */
export function createKernelRuntime(deps: KernelRuntimeDeps): KernelRuntime {
  const { opts, cwd, events, logger, state, loopState, phaseTimers } = deps

  // 最近一次插件钩子失败详情（runHooksForPhaseWithCapture 写，getLastPluginError 读）
  let lastPluginError: LastPluginError | null = null

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
      await runHooksForPhaseWithCapture(phase, 'before', deps.getPlugins(), deps.buildCtx())
      // 配置文件不存在直接抛 CONFIG_NOT_FOUND（退出码 2）
      if (!existsSync(opts.configPath)) {
        throw new KernelError('CONFIG_NOT_FOUND', `Config file not found: ${opts.configPath}`)
      }
      // 动态 import 打破 kernel ↔ config 的循环依赖（config 包反向依赖 kernel 的类型与错误类）
      const { loadConfig } = await import('@nx-mk/config')
      deps.setConfig(await loadConfig({ path: opts.configPath, cwd, runId: opts.runId, subcommand: opts.subcommand }))
      await runHooksForPhaseWithCapture(phase, 'after', deps.getPlugins(), deps.buildCtx())
    } else if (phase === 'resolvePlugins') {
      // —— 阶段 2：resolvePlugins —— 按配置的 plugins 列表动态加载 npm 插件包
      await runHooksForPhaseWithCapture(phase, 'before', deps.getPlugins(), deps.buildCtx())
      // 测试注入了 plugins 则跳过加载，否则走 plugin-registry 的动态 import 链路
      if (opts.plugins === undefined) {
        // Ruling 5 追加缝（excludePluginNames）：先过滤配置数组（防双实例双 launch）
        const excluded = new Set(opts.excludePluginNames ?? [])
        const config = deps.getConfig()!
        const names = excluded.size === 0
          ? config.plugins
          : config.plugins.filter((n) => !excluded.has(n))
        const loaded = await loadPlugins(names, { cwd, config })
        // Ruling 5 追加缝（extraPlugins）：加载完成后追加程序化装配的插件
        deps.setPlugins(opts.extraPlugins?.length ? [...loaded, ...opts.extraPlugins] : loaded)
        // 每加载成功一个插件：发 plugin:loaded 事件并写入内核状态
        for (const p of deps.getPlugins()) {
          events.emit({ type: 'plugin:loaded', name: p.name, version: p.version })
          state.loadedPlugins.push(p.name)
          // M1：每个加载成功的插件立即置为 active
          transitionPlugin(p.name, { kind: 'active', activatedAt: new Date().toISOString() })
        }
      } else {
        // 测试路径：注入的 plugins 也走 active 转移以保证 pluginStates 与 loadedPlugins 一致；
        // Ruling 5 追加缝（extraPlugins）：与生产路径语义一致，追加后同批转移
        if (opts.extraPlugins?.length) {
          deps.setPlugins([...deps.getPlugins(), ...opts.extraPlugins])
        }
        for (const p of deps.getPlugins()) {
          if (!state.loadedPlugins.includes(p.name)) {
            state.loadedPlugins.push(p.name)
          }
          transitionPlugin(p.name, { kind: 'active', activatedAt: new Date().toISOString() })
        }
      }
      await runHooksForPhaseWithCapture(phase, 'after', deps.getPlugins(), deps.buildCtx())
    } else if (phase === 'initPlugins') {
      // —— 阶段 3：initPlugins —— 校验插件依赖 + 预留的插件初始化阶段
      await runHooksForPhaseWithCapture(phase, 'before', deps.getPlugins(), deps.buildCtx())
      // M3：检查所有插件的 inject 依赖是否被 provide 满足
      // 不满足时抛 PLUGIN_DEPENDENCY_MISSING（退出码 7），fail-fast
      resolveDependencies(deps.getPlugins())
      // kernel default: no-op (plugin instance is already constructed)
      // 中文：内核默认无动作（插件对象在工厂调用时已构造完成），仅触发前后钩子
      await runHooksForPhaseWithCapture(phase, 'after', deps.getPlugins(), deps.buildCtx())
      // Phase 4.5（R7）：initPlugins 完成即快照插件清单供 dashboard 只读消费；
      // 生产装配与测试注入两条路径都在此收口。写失败静默（E4 兜底）。
      writePluginsManifest(cwd, buildPluginsManifest(deps.getPlugins(), deps.getConfig() ?? undefined))
    } else if (phase === 'run') {
      // —— 阶段 4：run —— 主工作阶段，触发 beforeRun 钩子后运行 Goal Loop（M14），
      // 最后触发 afterRun 钩子。Goal Loop 仅在 config.goal 定义时启用，否则保持
      // 原 push-based 行为（向后兼容）。
      // C1（Task 6 审查裁定）：reports/turn/idleTurns 重置必须在 beforeRun 钩子之前 ——
      // 否则 beforeRun 期 emitReport 的报告（如 plugin-playwright 的 field-hit）会在
      // Goal Loop 启动前被清空，spec §1.4.2「field-hit 提前 goal-met」静默失败。
      // initial coverage 仍在 beforeRun 之后读取（plugin-swagger 在 beforeRun 写 manifest）。
      loopState.reports = []
      loopState.turn = 0
      loopState.idleTurns = 0
      await runHooksForPhaseWithCapture(phase, 'before', deps.getPlugins(), deps.buildCtx())
      const config = deps.getConfig()
      if (config?.goal) {
        // Goal Loop 路径：构建共享循环状态 + AbortController
        // initial coverage 从 .nx-mk/manifest.json 读（plugin-swagger 在 beforeRun 写入）；
        // 文件缺失则回退 placeholder，让 demo 模式仍能跑通。
        loopState.coverage = readInitialCoverageFromManifest(cwd, {
          ignoredGlobs: (config as { coverage?: { ignored?: string[] } }).coverage?.ignored,
        })
        const goalAbort = new AbortController()
        // 触发手动 shutdown 时同步终止 goal loop
        if (deps.isManualShutdown()) goalAbort.abort()
        try {
          const goalResult = await runGoalLoop({
            plugins: deps.getPlugins(),
            goal: config.goal,
            initialCoverage: loopState.coverage,
            // 把 loopState 访问器注入 runGoalLoop —— 让 reports / turn 真正双向流动
            getReports: () => loopState.reports,
            onTurn: (t) => { loopState.turn = t },
            ctx: deps.buildCtx(),
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
            // GoalResult.terminatedBy 在 kind='unmet' 时只能是 4 种之一；其余视为内核 bug
            const reason = goalResult.terminatedBy
            switch (reason) {
              case 'max-turns':
              case 'idle':
              case 'timeout':
              case 'all-failed':
                events.emit({
                  type: 'goal:unmet',
                  reason,
                  coverage: goalResult.coverage,
                  turns: goalResult.turns,
                })
                break
              case 'goal-met':
              case 'aborted':
                // met 不应走 else 分支；aborted 单独事件类型，这里不应到达
                throw new KernelError(
                  'KERNEL_INTERNAL',
                  `Unexpected unmet terminatedBy: ${reason}`,
                )
              default:
                assertNever(reason)
            }
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
      await runHooksForPhaseWithCapture(phase, 'after', deps.getPlugins(), deps.buildCtx())
    } else if (phase === 'shutdown') {
      // —— 阶段 5：shutdown —— 关停收尾，插件按加载的逆序执行
      // Reverse order
      // 中文：逆序保证后加载的插件先清理，避免依赖反向残留
      const reversed = [...deps.getPlugins()].reverse()
      // Per spec §3.3, shutdown hook errors only log (don't throw)
      // 中文：shutdown 钩子异常只记录不抛出，保证其余插件也能完成收尾
      const safeRun = async (timing: 'before' | 'after') => {
        try {
          await runHooksForPhase(phase, timing, reversed, deps.buildCtx())
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

  return {
    runPhase,
    getLastPluginError: () => lastPluginError,
  }
}
