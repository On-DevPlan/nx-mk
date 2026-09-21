/**
 * @nx-mk/plugin-playwright —— 采集插件：headless chromium DOM 扫描（spec §3.4）
 *
 * v0 语义（重要，与任务简报的差异已在任务报告中记录）：
 * - 内核 Plugin 合约只有 before{Phase}/after{Phase} 钩子（无裸 run 钩子），
 *   故 v0 把【单次收集通路】放在 beforeRun 的 doctor 之后执行：
 *   goto → 扫描 → collector.evidence → snapshot → emitReport。
 *   （内核 C1 修复后在 beforeRun 之前重置 loopState.reports —— beforeRun 期的
 *   报告完整进入 Goal Loop，可驱动 spec §1.4.2 的 field-hit 提前 goal-met。）
 * - 不按 maxTurns 循环（单次收集，靠 Goal Loop idleTurns / maxTurns 终止）；
 *   maxTurns 字段在选项中保留，供后续版本启用逐 turn 驱动。
 * - 共享 collector（Ruling 2）：插件在工厂内创建（或接收注入的）collector，
 *   runner.launchCollect 把扫描 evidence 投给它；下一任务通过
 *   context.addInitScript 把它挂到浏览器 window.__MK_COLLECTOR__ 单通道。
 * - 报告双通道：扫描到的字段直接以 field-hit 报给 Goal Loop（emitReport）；
 *   endpoint-called 来自 collector.snapshot(turn)（浏览器侧 trace/hit 的增量）。
 *   不为 DOM 字段伪造 collector.hit —— 那会污染经 drain→SQLite 落盘的共享通道。
 * - collect 段类型来自 @nx-mk/config 的 CollectConfigSchema（Task 6 审查 M3：
 *   以 schema 为单一事实来源，替换本地宽松声明）。
 * - Ruling 7（Task 8）：浏览器通道已接线 —— runner.launchCollect addInitScript
 *   注入 window.__MK_COLLECTOR__ shim（demo 业务代码经 Ruling 6 缺省解析 hit/trace），
 *   页面工作完成后 drainBrowserCollector 回捞进共享 collector（先于 snapshot）。
 * - Ruling 8 限制（本任务不注入 manifest）：插件无法低成本拿到 ApiManifest（kernel
 *   ctx 不携带 manifest 文件内容，.nx-mk/manifest.json 读取需引入 manifest 包解析），
 *   故不注入 __MK_MANIFEST__。后果：浏览器侧 fetch 的 endpointId 落 'unknown' fallback
 *   （trace.sql endpoint_id 列为 NULL —— flushDrained 语义已覆盖）；request_traces 的
 *   method/path 全落入表。manifest 注入留给 Phase 3。
 * - §1.4.2 goal-met 延期（计划级记账，Phase 3 修）：goal-loop 的 field-hit 断言的
 *   id 空间是 manifest stableFieldId（哈希），而 DOM 直报 fieldId 是 dataMkField
 *   字符串 —— 两者恒不相等，coverage 永不匹配 → goal-met 经 field-hit 实际不可达；
 *   且 demo config 未配 goal: 段（Goal Loop 不启用，v0 demo = 单次收集 + maxTurns
 *   上限语义，terminatedBy 未持久化）。修法：goal 段接入 + normalizedPath 键域
 *   的映射 + manifest 注入，一并排 Phase 3。
 * - §26 套件模式分叉（S6/S9/SP3/SP6）：config.scenarios.include 非空时
 *   beforeRun 改走套件通路 —— loadScenarios → scenario:start 全量 emit →
 *   suiteRunner（缺省 runScenarioSuiteInBrowser，可注入测试缝）→ 逐结果
 *   scenario:done + 共享 collector snapshot 增量 flush → E8 失败汇总 warn
 *   （退出码不受影响）。observers：afterGoto = DOM 扫描 → field-hit 直报 +
 *   scanDom evidence 入共享通道；afterStep = drainBrowserCollector + §26
 *   归因标（scenarioId/dslStepId）。E2：include 0 命中 → warn 回落 legacy
 *   collect（collect 门不阻断套件模式 —— 套件是 collect 的替代入口）。
 * - Ruling 7 shim 语义补充（Task 8 审查 Important #3）：addInitScript 按文档重放
 *   —— 整页导航时 shim 重新初始化、缓冲清零；未及回捞的 hits/traces 即丢。v0
 *   可接受（demo 无整页导航），Phase 3 若需跨导航可改为 sessionStorage 或常态回捞。
 */
import {
  KernelError,
  type Plugin,
  type PluginContext,
  type PluginReport,
  type PluginConfigEntry,
  type ResolvedConfig,
} from '@nx-mk/kernel'
import { createCollector, type Collector, type CollectReport } from '@nx-mk/client/collector'
import type { CollectConfig, ScenarioConfig } from '@nx-mk/config'
import { scanDom } from '@nx-mk/coverage'
import {
  loadScenarios,
  runScenarioSuiteInBrowser,
  type Scenario,
  type ScenarioRunResult,
  type SuiteObservers,
} from '@nx-mk/scenario'
import { launchCollect, hasChromium } from './runner.js'
import { scanPage, drainBrowserCollector } from './scanner.js'

const PLUGIN_NAME = '@nx-mk/plugin-playwright'

export interface PlaywrightPluginOptions {
  /** 目标应用地址（config.collect.url 缺省时的回退） */
  url: string
  /** 页面就绪选择器，默认 '[data-mk-field]' */
  waitForSelector?: string
  /** 保留字段：v0 不循环强制（单次收集，靠 Goal Loop idle 终止） */
  maxTurns?: number
  /** 注入的共享 collector；缺省时插件自建 */
  collector?: Collector
  /** 测试注入缝（SP4）：套件执行器；缺省 = runScenarioSuiteInBrowser 真实现 */
  suiteRunner?: (
    scenarios: ReadonlyArray<Scenario>,
    opts: { concurrency: number; observers: SuiteObservers },
  ) => Promise<ScenarioRunResult[]>
}

export interface CollectTarget {
  url?: string
  waitForSelector?: string
}

/**
 * W1d：per-plugin config 优先级链 —— plugins 列表中本插件对象条目的 config
 * → 顶层 collect: 段 → 工厂 opts（CLI 装配注入）。
 *
 * 参数类型注：kernel 的 ResolvedConfig 不声明 collect 字段（该段是
 * @nx-mk/config schema 的事，kernel 仅以交集断言消费），故 collect 以
 * schema 的 CollectConfig 交集补入，plugins 仍取自 ResolvedConfig。
 */
export function resolveCollectTarget(
  config: Pick<ResolvedConfig, 'plugins'> & { collect?: CollectConfig },
  fallback: CollectTarget,
): CollectTarget {
  const own = config.plugins.find(
    (e): e is PluginConfigEntry => typeof e === 'object' && e !== null && e.name === PLUGIN_NAME,
  )
  const cfg = (own?.config ?? {}) as { url?: string; waitForSelector?: string }
  return {
    url: cfg.url ?? config.collect?.url ?? fallback.url,
    waitForSelector: cfg.waitForSelector ?? config.collect?.waitForSelector ?? fallback.waitForSelector,
  }
}

/** CollectReport → PluginReport 映射（补齐可选字段的缺省值） */
function toReport(r: CollectReport, turn: number): PluginReport {
  if (r.kind === 'field-hit') {
    return { kind: 'field-hit', fieldId: r.fieldId ?? '(unknown)', count: r.count, turn }
  }
  return { kind: 'endpoint-called', method: r.method ?? 'GET', path: r.path ?? '(unknown)', turn }
}

export function createPlaywrightPlugin(opts: PlaywrightPluginOptions): Plugin {
  const collector = opts.collector ?? createCollector()
  // 最近一次收集通路的统计（afterRun 汇总日志用）
  let lastPass: { url: string; fields: number; reports: number } | null = null

  // —— legacy 单次收集通路（原 beforeRun 主体抽出，行为逐字保持）：
  // collect 门（collect 段或本插件条目）→ chromium 门 → doctor 自检 →
  // launchCollect → field-hit 直报 → snapshot 增量 → emitReport。
  const legacyCollect = async (ctx: PluginContext): Promise<void> => {
    const cmd = ctx.kernel.getSubcommand()
    // M3（Task 6 审查）：collect 段类型经 schema 收窄读取 —— kernel 的
    // ResolvedConfig 尚未声明该字段，交集断言保证与 schema 类型一致。
    // W1d：plugins 列表存在本插件对象条目时视同已配置采集（条目级 config
    // 等价于已配置采集），不因顶层 collect: 段缺失而静默跳过。
    const config = ctx.config as ResolvedConfig
    const collect = (ctx.config as typeof ctx.config & { collect?: CollectConfig }).collect
    const hasOwnEntry = config.plugins.some(
      (e): e is PluginConfigEntry => typeof e === 'object' && e !== null && e.name === PLUGIN_NAME,
    )
    if (!collect && !hasOwnEntry) {
      ctx.logger.info('plugin-playwright: collect not configured, skipping', { cmd })
      return
    }
    if (!(await hasChromium())) {
      throw new KernelError(
        'PLUGIN_HOOK_FAILED',
        'plugin-playwright: chromium browser not available — run `npx playwright install chromium` first',
      )
    }
    // doctor 只做环境自检（chromium 可用性），不执行完整页面收集
    if (cmd !== 'run') return

    const target = resolveCollectTarget(config, opts)
    const url = target.url
    if (!url) {
      ctx.logger.warn('plugin-playwright: collect.url missing and no plugin url fallback')
      return
    }
    const waitForSelector = target.waitForSelector ?? '[data-mk-field]'

    let descs
    try {
      descs = await launchCollect(
        { url, waitForSelector },
        collector,
        // spec §4 row 3：DOM 扫描失败包容为空 evidence + warn，不阻断 Goal Loop
        (err) => {
          ctx.logger.warn('plugin-playwright: DOM scan failed — evidence for this turn is empty', {
            url,
            error: (err as Error).message,
          })
        },
      )
    } catch (err) {
      throw new KernelError(
        'PLUGIN_HOOK_FAILED',
        `plugin-playwright: collection failed for ${url}: ${(err as Error).message}`,
        err,
      )
    }

    const turn = ctx.getTurn()
    // 扫描到的 DOM 字段 → Goal Loop field-hit（UI 出现即视为字段触达信号）。
    // 空 dataMkField 与 scanDom 的过滤语义一致（evidence 侧已剔除）——报告侧
    // 同样跳过，避免产出 fieldId 为空串的垃圾报告。
    for (const d of descs) {
      if (d.dataMkField === '') continue
      ctx.emitReport({ kind: 'field-hit', fieldId: d.dataMkField, count: 1, turn })
    }
    // 共享 collector 的增量（浏览器侧 trace/hit；本任务由测试预置）→ 报告
    const snapshotReports = collector.snapshot(turn)
    for (const r of snapshotReports) {
      ctx.emitReport(toReport(r, turn))
    }
    const fieldCount = descs.filter((d) => d.dataMkField !== '').length
    lastPass = { url, fields: fieldCount, reports: fieldCount + snapshotReports.length }
    ctx.logger.info('plugin-playwright: collection pass done', lastPass)
  }

  // —— §26 套件模式（S6/S9/SP3/SP6）：scenarios.include 非空时的替代通路。
  // loadScenarios → scenario:start 全量 → suiteRunner（缺省真实现）→
  // 逐结果 scenario:done + snapshot 增量 flush → E8 失败汇总（退出码不受影响）。
  const runSuite = async (ctx: PluginContext, cfg: ScenarioConfig): Promise<void> => {
    const cmd = ctx.kernel.getSubcommand()
    const cwd = typeof ctx.cwd === 'string' ? ctx.cwd : process.cwd()
    const { scenarios, skipped } = loadScenarios(cwd, cfg.include ?? [])
    for (const s of skipped) ctx.logger.warn(`plugin-playwright: scenario skipped — ${s}`)
    // E2：0 命中 → warn + 回落 legacy collect（其自身的 collect 门/doctor 语义完整复用）
    if (scenarios.length === 0) {
      ctx.logger.warn('plugin-playwright: scenarios.include matched 0 files — falling back to legacy collect')
      return legacyCollect(ctx)
    }
    // E3：chromium fail-fast（与 legacy 同错误码同文案）
    if (!(await hasChromium())) {
      throw new KernelError(
        'PLUGIN_HOOK_FAILED',
        'plugin-playwright: chromium browser not available — run `npx playwright install chromium` first',
      )
    }
    // doctor 只自检环境（加载/chromium），不执行套件 —— 与 legacy 语义对齐
    if (cmd !== 'run') return

    // SP6：observers = 插件归因接线 —— afterGoto 扫描直报 field-hit（与
    // legacy 同语义：scanPage 包容失败为空 evidence + warn；scanDom 推共享
    // collector 供 drain→SQLite）；afterStep 回捞页内 shim 并打 §26 归因标（S6）。
    const observers: SuiteObservers = {
      afterGoto: async (_sid, page, url) => {
        const turn = ctx.getTurn()
        const descs = await scanPage(
          (script) => page.evaluate(script),
          (err) => {
            ctx.logger.warn('plugin-playwright: DOM scan failed — evidence for this page is empty', {
              url,
              error: (err as Error).message,
            })
          },
        )
        for (const ev of scanDom(descs)) collector.evidence(ev)
        for (const d of descs) {
          if (d.dataMkField === '') continue
          ctx.emitReport({ kind: 'field-hit', fieldId: d.dataMkField, count: 1, turn })
        }
      },
      afterStep: async (_sid, tag, page) => {
        await drainBrowserCollector((fn) => page.evaluate(fn as never), collector, tag)
      },
    }
    // S9 批次语义：scenario:start 全量 emit 先于执行（批次开始，简单诚实）
    for (const { scenario } of scenarios) {
      ctx.events.emit({ type: 'scenario:start', scenarioId: scenario.id, timestamp: new Date().toISOString() })
    }
    const runner = opts.suiteRunner ?? runScenarioSuiteInBrowser
    const results = await runner(
      scenarios.map((s) => s.scenario),
      { concurrency: cfg.concurrency ?? 3, observers },
    )
    // SP3：turn 取一次；snapshot 增量幂等 —— 逐结果 flush 执行期累积的新增量
    const turn = ctx.getTurn()
    for (const r of results) {
      ctx.events.emit({ type: 'scenario:done', scenarioId: r.scenarioId, ok: r.ok, timestamp: new Date().toISOString() })
      for (const rep of collector.snapshot(turn)) ctx.emitReport(toReport(rep, turn))
    }
    // E8：失败汇总 warn（退出码不受影响 —— 不抛）
    const failed = results.filter((r) => !r.ok)
    if (failed.length > 0) {
      ctx.logger.warn(
        `plugin-playwright: ${failed.length}/${results.length} scenarios failed — [${failed.map((f) => f.scenarioId).join(', ')}]`,
      )
    }
  }

  return {
    name: '@nx-mk/plugin-playwright',
    version: '0.1.0',
    hooks: {
      // §26 分叉（beforeRun 主体）：
      // 1) cmd 门（run/doctor）→ 2) scenarios.include 非空 → 套件模式
      // （collect 门不适用 —— 套件是 collect 的替代入口）；否则 legacy collect。
      async beforeRun(ctx) {
        const cmd = ctx.kernel.getSubcommand()
        if (cmd !== 'run' && cmd !== 'doctor') return

        // scenarios 段类型经 @nx-mk/config schema 收窄读取（同 collect 段的交集断言手法）
        const scenariosCfg = (ctx.config as typeof ctx.config & { scenarios?: ScenarioConfig }).scenarios
        if (scenariosCfg?.include?.length) {
          await runSuite(ctx, scenariosCfg)
          return
        }
        await legacyCollect(ctx)
      },

      // 收尾：汇总日志（浏览器已在 runner 的 finally 中关闭；drain→SQLite 由 coverage 侧接线）
      async afterRun(ctx) {
        if (lastPass) {
          ctx.logger.info('plugin-playwright: collection summary', { ...lastPass, cmd: ctx.kernel.getSubcommand() })
        }
      },
    },
  }
}

/**
 * default export —— 无参工厂（Ruling 5 / Task 7 审查 Adjudication B 第 1 项）：
 * plugin-registry 按 `mod.default` 解析工厂并【零参调用】，本插件原仅具名
 * `createPlaywrightPlugin(opts)`（opts 必填）→ 配置驱动加载今日即 PLUGIN_SHAPE_INVALID。
 * 插件运行期配置自读 `ctx.config.collect`，故无参工厂只需回退空 url；
 * demo 主路径走 run.ts 代码装配（传入共享 collector），此导出保证注册表形状兼容与独立使用。
 */
export default function createPlaywrightPluginDefault(): Plugin {
  return createPlaywrightPlugin({ url: '' })
}
