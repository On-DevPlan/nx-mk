/**
 * runner —— Playwright 浏览器生命周期 + DOM 扫描执行（spec §3.4）
 *
 * 唯一接触 playwright-core 的模块：launch() → newContext（含 addInitScript 注入
 * window.__MK_COLLECTOR__ shim，Ruling 7）→ goto(networkidle) → waitForSelector
 * → page.evaluate(PAGE_SCAN_SCRIPT) → toDescriptors → collector.evidence 逐条
 * 投递 → drainBrowserCollector 回捞浏览器侧 trace/hit 进共享 collector（Ruling 7，
 * 先于插件层 snapshot(turn)）。
 *
 * 测试边界：本模块被 __tests__/plugin.test.ts 整体 vi.mock —— playwright-core
 * 永不在单测中加载；插件侧编排（collector 投递 → snapshot → emitReport）
 * 由 mock 镜像同一契约驱动。
 */
import { chromium } from 'playwright-core'
import { scanDom } from '@nx-mk/coverage'
import type { Collector } from '@nx-mk/client/collector'
import { scanPage, COLLECTOR_SHIM_SCRIPT, drainBrowserCollector, type ParsedDescriptor } from './scanner.js'

/** 收集配置（来自 config.collect 或插件选项） */
export interface CollectConfig {
  url: string
  waitForSelector?: string
  /** 额外 initScript（manifest shim 等），先于 COLLECTOR_SHIM_SCRIPT 注入 */
  initScripts?: ReadonlyArray<string>
}

/**
 * launchCollect —— 单次收集通路：
 * 打开 headless chromium → 等待页面就绪 → 注入扫描脚本 → 描述符逐条
 * 转 UiEvidenceCore 投给共享 collector（Ruling 2 的内核侧单通道），
 * 返回原始描述符数组供插件层生成 Goal Loop 报告。
 *
 * 错误分级（spec §4）：goto / waitForSelector 失败 → 向上抛（row 2 fail-fast）；
 * DOM 扫描（evaluate）失败 → scanPage 包容为 [] 并经 onScanError 告警
 * （row 3：该 turn evidence 为空，Goal Loop 不被阻断）。
 */
export async function launchCollect(
  config: CollectConfig,
  collector: Collector,
  onScanError?: (err: unknown) => void,
): Promise<ParsedDescriptor[]> {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    // Ruling 6/7/8：initScript 注入 —— manifest shim 在前（数据源：__MK_MANIFEST__ 供
    // demo SDK matchEndpoint 解析真实 endpointId），collector shim 在后（传输通道：
    // __MK_COLLECTOR__ 缓冲，页代码 Ruling 6 缺省解析往这里 hit/trace）。
    // 两者皆为可序列化字面量，页脚本运行前全部就位。
    for (const script of [...(config.initScripts ?? []), COLLECTOR_SHIM_SCRIPT]) {
      await context.addInitScript(script)
    }
    const page = await context.newPage()
    await page.goto(config.url, { waitUntil: 'networkidle' })
    await page.waitForSelector(config.waitForSelector ?? '[data-mk-field]')
    const descs = await scanPage((script) => page.evaluate(script), onScanError)
    for (const ev of scanDom(descs)) collector.evidence(ev)
    // Ruling 7：DOM 扫描后回捞浏览器侧缓冲 → 共享 collector（collector.trace/hit）
    // 并清空页内缓冲 —— 必须先于插件层的 snapshot(turn)（增量去重依赖回捞先落位）
    await drainBrowserCollector((fn) => page.evaluate(fn as never), collector)
    return descs
  } finally {
    await browser.close()
  }
}

// S4：hasChromium 迁入 @nx-mk/scenario（依赖方向 plugin-playwright → scenario）；re-export 向后兼容
export { hasChromium } from '@nx-mk/scenario'
