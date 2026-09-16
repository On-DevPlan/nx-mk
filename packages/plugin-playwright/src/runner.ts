/**
 * runner —— Playwright 浏览器生命周期 + DOM 扫描执行（spec §3.4）
 *
 * 唯一接触 playwright-core 的模块：launch() → newContext（含共享 collector
 * 注入占位）→ goto(networkidle) → waitForSelector → page.evaluate(PAGE_SCAN_SCRIPT)
 * → toDescriptors → collector.evidence 逐条投递。
 *
 * 测试边界：本模块被 __tests__/plugin.test.ts 整体 vi.mock —— playwright-core
 * 永不在单测中加载；插件侧编排（collector 投递 → snapshot → emitReport）
 * 由 mock 镜像同一契约驱动。
 */
import { chromium } from 'playwright-core'
import { scanDom } from '@nx-mk/coverage'
import type { Collector } from '@nx-mk/client/collector'
import { PAGE_SCAN_SCRIPT, toDescriptors, type ParsedDescriptor } from './scanner.js'

/** 收集配置（来自 config.collect 或插件选项） */
export interface CollectConfig {
  url: string
  waitForSelector?: string
}

/**
 * launchCollect —— 单次收集通路：
 * 打开 headless chromium → 等待页面就绪 → 注入扫描脚本 → 描述符逐条
 * 转 UiEvidenceCore 投给共享 collector（Ruling 2 的内核侧单通道），
 * 返回原始描述符数组供插件层生成 Goal Loop 报告。
 */
export async function launchCollect(
  config: CollectConfig,
  collector: Collector,
): Promise<ParsedDescriptor[]> {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    // TODO(Task 7 / spec §3.5)：共享 collector 注入 —— 通过 context.addInitScript
    // 把内核侧 collector 的序列化传输载体挂到 window.__MK_COLLECTOR__（占位，
    // 浏览器侧 fetch/XHR 代理的接线在下一任务完成）。
    await context.addInitScript(() => {
      void 0 // 占位：window.__MK_COLLECTOR__ 注入点（Task 7）
    })
    const page = await context.newPage()
    await page.goto(config.url, { waitUntil: 'networkidle' })
    await page.waitForSelector(config.waitForSelector ?? '[data-mk-field]')
    const raw = await page.evaluate(PAGE_SCAN_SCRIPT)
    const descs = toDescriptors(raw)
    for (const ev of scanDom(descs)) collector.evidence(ev)
    return descs
  } finally {
    await browser.close()
  }
}

/**
 * hasChromium —— doctor 检查：尝试真实 launch 一次 headless chromium。
 * 缺浏览器二进制（npx playwright install 未执行）时 launch 会 reject → false。
 */
export async function hasChromium(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true })
    await browser.close()
    return true
  } catch {
    return false
  }
}
