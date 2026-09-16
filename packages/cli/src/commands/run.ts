/**
 * run 子命令 —— 以完整 5 阶段生命周期启动内核（默认子命令）
 *
 * 创建内核并调用 api.run()：loadConfig → resolvePlugins → initPlugins
 * → run → shutdown；成功后打印运行 ID、耗时与产物目录位置。
 *
 * Phase 2（spec §3.6）：config.collect 存在时装配采集落盘 ——
 * 预读配置校验 collect.url（http/https）→ 建立 .nx-mk/coverage.db 并 insertRun；
 * run 结束后 endRun + drain 共享 collector → flushDrained（spec §4：SQLite 写入
 * 失败 fail-fast，数据完整性优先）；失败路径把 runs 行收尾为 failed 后原样抛出。
 * Ruling 5（Task 7 审查）：collect 存在时代码装配 plugin-playwright —— 共享
 * collector 单实例同时喂插件（浏览器采集）与 flush 通道（SQLite 落盘）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createKernel, makeRunId, KernelError, type LogLevel, type Plugin } from '@nx-mk/kernel'
import { loadConfig, type CollectConfig } from '@nx-mk/config'
import { openCoverageDb, type CoverageDb } from '@nx-mk/coverage'
import { createCollector, type Collector } from '@nx-mk/client/collector'

// run 子命令入参：配置路径 + 运行 ID + CLI 级配置覆盖
// cwd / collector 为装配缝：cwd 供测试注入 tmp 目录（db 落点），collector 供采集
// 通道接入（demo 浏览器单通道 __MK_COLLECTOR__ 的共享 collector，Task 8 接线）
export interface RunMainOptions {
  configPath: string
  runId: string
  cwd?: string
  collector?: Collector
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
}

// 创建内核（cwd 取当前进程目录）并驱动完整生命周期；错误向上抛给 CLI 顶层处理
export async function runMain(opts: RunMainOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  const runId = makeRunId(opts.runId)
  // 预读配置判定 collect 段（内核 loadConfig 阶段会再读一次，5 阶段保持不变）；
  // 先自行校验存在性，保持与内核一致的 CONFIG_NOT_FOUND 语义
  if (!existsSync(opts.configPath)) {
    throw new KernelError('CONFIG_NOT_FOUND', `Config file not found: ${opts.configPath}`)
  }
  const config = await loadConfig({ path: opts.configPath, cwd, runId, subcommand: 'run' })
  // ResolvedConfig（kernel 类型）未声明 collect 段 —— 以 schema 推导类型收窄读取
  const collect = (config as typeof config & { collect?: CollectConfig }).collect
  // spec §3.6/§4：collect.url 必填且须 http/https（用户需先起 vite）—— 非法即 fail-fast
  if (collect && !/^https?:\/\//.test(collect.url)) {
    throw new KernelError('CONFIG_INVALID', `collect.url must be an http(s) URL, got: ${collect.url}`)
  }
  // spec §3.6：collect 配置时建立 coverage.db 并登记本次 run（§25.1 runs 表）
  let db: CoverageDb | undefined
  if (collect) {
    mkdirSync(join(cwd, '.nx-mk'), { recursive: true })
    db = openCoverageDb(join(cwd, '.nx-mk', 'coverage.db'))
    db.insertRun(runId, new Date().toISOString(), 'running')
  }
  // Ruling 5（Task 7 审查 Adjudication B）：collect 存在 → 代码装配 ——
  // run.ts 建共享 collector（注入优先；同一实例既喂 plugin-playwright 又供 flush 通道），
  // 程序化构造 plugin-playwright 经 extraPlugins 追加进 kernel 插件列表；
  // 配置 plugins 数组里若仍声明本插件则被 excludePluginNames 过滤（防双实例双 launch）。
  const collector = opts.collector ?? (collect ? createCollector() : undefined)
  let extraPlugins: Plugin[] | undefined
  if (collect && collector) {
    let createPlaywrightPlugin: (o: { url: string; collector: Collector }) => Plugin
    try {
      // 动态 import：非 collect 运行不加载 playwright-core；装配失败按插件加载错误映射
      ({ createPlaywrightPlugin } = await import('@nx-mk/plugin-playwright'))
    } catch (err) {
      throw new KernelError(
        'PLUGIN_LOAD_FAILED',
        `Failed to assemble @nx-mk/plugin-playwright: ${(err as Error).message}`,
        err,
      )
    }
    extraPlugins = [createPlaywrightPlugin({ url: collect.url, collector })]
  }
  const kernel = createKernel({
    configPath: opts.configPath,
    runId,
    subcommand: 'run',
    cwd,
    ...(extraPlugins
      ? { extraPlugins, excludePluginNames: ['@nx-mk/plugin-playwright'] }
      : {}),
  })
  try {
    const result = await kernel.run()
    console.log(`✔ Run ${result.runId} completed in ${result.durationMs}ms`)
    console.log(`  Logs: .nx-mk/runs/${result.runId}/`)
    if (db) {
      db.endRun(runId, new Date().toISOString(), 'completed')
      // spec §4：flush SQLite 写入失败 = fail-fast（数据完整性优先于静默失败）
      if (collector) db.flushDrained({ runId, ...collector.drain() })
      // I1（Task 7 审查）：collect 配置而 flush 通道无 collector —— 防御性 warn。
      // Ruling 5 装配后 collect 存在即有共享实例，此行守护未来装配被破坏的场景
      // （静默空 flush —— db 存在但三表全空 —— 是验收调试的时间黑洞）。
      else if (collect)
        console.warn(
          'collect configured but no shared collector injected — evidence/trace data will not be persisted',
        )
    }
  } catch (err) {
    if (db) {
      // 失败收尾：runs 行标记 failed 并尽力 flush 已采数据；收尾异常不掩盖原始错误
      try {
        db.endRun(runId, new Date().toISOString(), 'failed')
        if (collector) db.flushDrained({ runId, ...collector.drain() })
      } catch {
        /* 保留原始错误向上抛出 */
      }
    }
    throw err
  } finally {
    db?.close()
  }
}
