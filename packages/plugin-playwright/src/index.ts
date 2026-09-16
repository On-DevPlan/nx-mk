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
 */
import { KernelError, type Plugin, type PluginReport } from '@nx-mk/kernel'
import { createCollector, type Collector, type CollectReport } from '@nx-mk/client/collector'
import type { CollectConfig } from '@nx-mk/config'
import { launchCollect, hasChromium } from './runner.js'

export interface PlaywrightPluginOptions {
  /** 目标应用地址（config.collect.url 缺省时的回退） */
  url: string
  /** 页面就绪选择器，默认 '[data-mk-field]' */
  waitForSelector?: string
  /** 保留字段：v0 不循环强制（单次收集，靠 Goal Loop idle 终止） */
  maxTurns?: number
  /** 注入的共享 collector；缺省时插件自建 */
  collector?: Collector
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

  return {
    name: '@nx-mk/plugin-playwright',
    version: '0.1.0',
    hooks: {
      // doctor + 单次收集通路：
      // 1) collect 未配置 → 静默跳过；2) chromium 缺失 → fail-fast（PLUGIN_HOOK_FAILED）
      // 3) 就绪 → 扫描 → evidence → snapshot → emitReport（浏览器生命周期在 runner 内闭环）
      async beforeRun(ctx) {
        const cmd = ctx.kernel.getSubcommand()
        if (cmd !== 'run' && cmd !== 'doctor') return

        // M3（Task 6 审查）：collect 段类型经 schema 收窄读取 —— kernel 的
        // ResolvedConfig 尚未声明该字段，交集断言保证与 schema 类型一致
        const collect = (ctx.config as typeof ctx.config & { collect?: CollectConfig }).collect
        if (!collect) {
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

        const url = collect.url ?? opts.url
        if (!url) {
          ctx.logger.warn('plugin-playwright: collect.url missing and no plugin url fallback')
          return
        }
        const waitForSelector = collect.waitForSelector ?? opts.waitForSelector ?? '[data-mk-field]'

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
