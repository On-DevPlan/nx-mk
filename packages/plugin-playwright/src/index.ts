/**
 * @nx-mk/plugin-playwright —— 采集插件：headless chromium DOM 扫描（spec §3.4）
 *
 * v0 语义（单次收集，靠 Goal Loop idleTurns / maxTurns 终止）：
 * - 内核 Plugin 合约只有 before{Phase}/after{Phase} 钩子（无裸 run 钩子），
 *   故把【单次收集通路】放在 beforeRun：goto → 扫描 → collector.evidence →
 *   snapshot → emitReport；完成后 emitSignal({kind:'done'}) 供 Goal Loop
 *   all-done 早停（不按 maxTurns 循环；maxTurns 字段保留供后续版本启用逐 turn 驱动）。
 * - 共享 collector（Ruling 2）：插件在工厂内创建（或接收注入的）collector，
 *   runner.launchCollect 把扫描 evidence 投给它；经 context.addInitScript 把
 *   collector shim 挂到浏览器 window.__MK_COLLECTOR__ 单通道。
 * - 报告双通道：扫描到的字段直接以 field-hit 报给 Goal Loop（emitReport）；
 *   endpoint-called 来自 collector.snapshot(turn)（浏览器侧 trace 的增量，
 *   判别联合 method/path 恒在）。不为 DOM 字段伪造 collector.hit。
 * - manifest 接线（原 Ruling 8，已落地）：beforeRun 读 .nx-mk/manifest.json
 *   （与 kernel initial-coverage 同路径语义）—— ① DOM dataMkField 直报前过
 *   normalizedPath 校验集（spec §3.1 id-space 对齐：Goal Loop missing 项键域
 *   即 normalizedPath，域内匹配使 field-hit → goal-met 可达）；缺席降级 warn
 *   一次 + 不校验直报。② buildManifestShimScript 注入 window.__MK_MANIFEST__，
 *   demo SDK（@nx-mk/client runtime）浏览器侧 matchEndpoint 据此解析真实
 *   endpointId（trace/hit 不再落 'unknown'，SQLite endpoint_id 不再 NULL）。
 * - Ruling 7 shim 语义：addInitScript 按文档重放 —— 整页导航时 shim 重新
 *   初始化、缓冲清零；未及回捞的 hits/traces 即丢。v0 可接受（demo 无整页
 *   导航），跨导航需求留 sessionStorage 或常态回捞方案。
 * - §26 套件模式分叉（S6/S9/SP3/SP6）：config.scenarios.include 非空时
 *   beforeRun 改走套件通路 —— loadScenarios → scenario:start 全量 emit →
 *   suiteRunner（缺省 runScenarioSuiteInBrowser，可注入测试缝）→ 逐结果
 *   scenario:done + 共享 collector snapshot 增量 flush → E8 失败汇总 warn
 *   （退出码不受影响）。observers：afterGoto = DOM 扫描 → field-hit 直报
 *   （同一 manifest 校验）+ scanDom evidence 入共享通道；afterStep =
 *   drainBrowserCollector + §26 归因标（scenarioId/dslStepId）。E2：include
 *   0 命中 → warn 回落 legacy collect（collect 门不阻断套件模式）。
 * - per-run 生命周期门（v1.1）：manifest 缺席 warn 与 done 信号都只挂在本
 *   插件工厂实例上（plugin-registry 每次运行重新装配 → 无跨 run 泄漏）。
 */
import { z } from 'zod'
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
import { scanPage, drainBrowserCollector, COLLECTOR_SHIM_SCRIPT } from './scanner.js'
import { readManifest, buildFieldPathSet, buildManifestShimScript } from './manifest.js'

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
    opts: {
      concurrency: number
      observers: SuiteObservers
      /** SP10：逐 context addInitScript 注入（套件页 collector shim 通道） */
      initScripts: ReadonlyArray<string>
    },
  ) => Promise<ScenarioRunResult[]>
}

export interface CollectTarget {
  url?: string
  waitForSelector?: string
}

/** 去重（T3 审查 parked）：判断 plugins 条目是否为本插件对象条目 */
const isOwnEntry = (e: string | PluginConfigEntry): e is PluginConfigEntry =>
  typeof e === 'object' && e !== null && e.name === PLUGIN_NAME

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
  const own = config.plugins.find(isOwnEntry)
  const cfg = (own?.config ?? {}) as { url?: string; waitForSelector?: string }
  return {
    url: cfg.url ?? config.collect?.url ?? fallback.url,
    waitForSelector: cfg.waitForSelector ?? config.collect?.waitForSelector ?? fallback.waitForSelector,
  }
}

/** CollectReport → PluginReport（判别联合两端字段恒在 —— 无需伪造缺省） */
function toReport(r: CollectReport, turn: number): PluginReport {
  if (r.kind === 'field-hit') {
    return { kind: 'field-hit', fieldId: r.fieldId, count: r.count, turn }
  }
  return { kind: 'endpoint-called', method: r.method, path: r.path, turn }
}

export function createPlaywrightPlugin(opts: PlaywrightPluginOptions): Plugin {
  const collector = opts.collector ?? createCollector()
  // 最近一次收集通路的统计（afterRun 汇总日志用）
  let lastPass: { url: string; fields: number; reports: number } | null = null
  // manifest 缺席 warn 每插件实例至多一次（套件 0 命中回退 legacy 时不双 warn）
  let manifestWarned = false

  // Ruling 8 落地：读 manifest → { fieldSet, shimScript }；缺席降级 warn 一次 + 不校验直报。
  // manifest 由 plugin-swagger 在更早的 beforeRun 写入（config 插件先于 extraPlugins），
  // 正常 run 时序下必然存在；缺席仅见于未配 openapi / 独立测试装配。
  const resolveManifest = (ctx: PluginContext): { fieldSet: Set<string> | null; shimScript: string | null } => {
    const cwd = typeof ctx.cwd === 'string' ? ctx.cwd : process.cwd()
    const manifest = readManifest(cwd)
    if (!manifest) {
      if (!manifestWarned) {
        manifestWarned = true
        ctx.logger.warn('plugin-playwright: .nx-mk/manifest.json not found — field-hit validation and __MK_MANIFEST__ injection skipped', { cwd })
      }
      return { fieldSet: null, shimScript: null }
    }
    return { fieldSet: buildFieldPathSet(manifest), shimScript: buildManifestShimScript(manifest) }
  }

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
    const hasOwnEntry = config.plugins.some((e) => isOwnEntry(e))
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

    // Ruling 8：manifest 校验键域 + 浏览器注入脚本（缺席 → null，runner 不注 manifest shim）
    const { fieldSet, shimScript } = resolveManifest(ctx)

    let descs
    try {
      descs = await launchCollect(
        {
          url,
          waitForSelector,
          ...(shimScript !== null ? { initScripts: [shimScript] } : {}),
        },
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
    // 同样跳过；manifest 存在时只报已知 normalizedPath（垃圾 fieldId 不进 Goal Loop）。
    for (const d of descs) {
      if (d.dataMkField === '') continue
      if (fieldSet && !fieldSet.has(d.dataMkField)) continue
      ctx.emitReport({ kind: 'field-hit', fieldId: d.dataMkField, count: 1, turn })
    }
    // 共享 collector 的增量（浏览器侧 trace；本任务由测试预置）→ 报告
    const snapshotReports = collector.snapshot(turn)
    for (const r of snapshotReports) {
      ctx.emitReport(toReport(r, turn))
    }
    const fieldCount = descs.filter((d) => d.dataMkField !== '' && (!fieldSet || fieldSet.has(d.dataMkField))).length
    lastPass = { url, fields: fieldCount, reports: fieldCount + snapshotReports.length }
    ctx.logger.info('plugin-playwright: collection pass done', lastPass)
    // 单次收集完成声明 → Goal Loop all-done 早停（原 v0 烧满 maxTurns 的零进展轮次消除）
    ctx.emitSignal({ kind: 'done', reason: 'all-collected', turn })
  }

  // —— §26 套件模式（S6/S9/SP3/SP6）：scenarios.include 非空时的替代通路。
  // loadScenarios → scenario:start 全量 → suiteRunner（缺省真实现）→
  // 逐结果 scenario:done + snapshot 增量 flush → E8 失败汇总（退出码不受影响）。
  const runSuite = async (ctx: PluginContext, cfg: ScenarioConfig): Promise<void> => {
    const cmd = ctx.kernel.getSubcommand()
    // Ruling 8：套件通路同一 manifest 接线（校验键域 + 注入脚本；缺席 warn 一次）
    const { fieldSet, shimScript } = resolveManifest(ctx)
    const cwd = typeof ctx.cwd === 'string' ? ctx.cwd : process.cwd()
    const { scenarios, skipped } = loadScenarios(cwd, cfg.include ?? [])
    for (const s of skipped) ctx.logger.warn(`plugin-playwright: scenario skipped — ${s}`)
    // E2：0 命中 → warn + 回落 legacy collect（其自身的 collect 门/doctor 语义完整复用；
    // manifestWarned 旗标保证 warn 不重复）
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

    // SP6：observers = 插件归因接线 —— afterGoto 扫描直报 field-hit（与 legacy 同语义：
    // manifest 校验 + scanPage 包容失败为空 evidence + warn；scanDom 推共享 collector 供
    // drain→SQLite）；afterStep 回捞页内 shim 并打 §26 归因标（S6）。
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
          if (fieldSet && !fieldSet.has(d.dataMkField)) continue
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
      {
        concurrency: cfg.concurrency ?? 3,
        observers,
        // SP10：套件 context 注入 initScripts —— manifest shim 在前（数据源）、
        // collector shim 在后（SP10 通道），legacy collect 同序（Ruling 7/8）
        initScripts: [...(shimScript !== null ? [shimScript] : []), COLLECTOR_SHIM_SCRIPT],
      },
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
    // 套件批次完成声明 → Goal Loop all-done 早停（与 legacy 同语义）
    ctx.emitSignal({ kind: 'done', reason: 'all-collected', turn })
  }

  return {
    name: '@nx-mk/plugin-playwright',
    version: '0.1.0',
    // M2 configSchema：per-plugin 条目 config 的校验面（与 resolveCollectTarget
    // 实际消费的字段一致）。zod 原生满足 StandardSchemaV1 —— kernel plugin-registry
    // 的 validateConfigSchema 直接可用；仅 config 声明路径生效（extraPlugins 代码
    // 装配不经 loadPlugins，见插件 README）。
    configSchema: z.object({
      url: z.string().optional(),
      waitForSelector: z.string().optional(),
    }),
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
