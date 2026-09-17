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
 *
 * Phase 3（spec §3.5）：成功路径 flushDrained 后跑 analyzer —— 读 .nx-mk/manifest.json
 * + config coverage 段 → CoverageReport → stdout 三指标摘要 + coverage-report.json
 * 落盘 → endRun 带 RunResult.terminatedBy（§3.1 审计链）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createKernel, makeRunId, KernelError, type LogLevel, type Plugin } from '@nx-mk/kernel'
import { loadConfig, type CollectConfig, type CoverageConfig } from '@nx-mk/config'
import {
  openCoverageDb,
  analyzeCoverage,
  evaluatePolicy,
  type AnalyzeInput,
  type CoverageDb,
} from '@nx-mk/coverage'
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
  // 终审 Important #1：createKernel 也要在 try 内 —— 否则内核构造抛错时 runs 行
  // 永远停在 'running' 且 db 句柄泄漏。失败收尾/关闭语义与 kernel.run() 一致。
  try {
    const kernel = createKernel({
      configPath: opts.configPath,
      runId,
      subcommand: 'run',
      cwd,
      ...(extraPlugins
        ? { extraPlugins, excludePluginNames: ['@nx-mk/plugin-playwright'] }
        : {}),
    })
    const result = await kernel.run()
    console.log(`✔ Run ${result.runId} completed in ${result.durationMs}ms`)
    console.log(`  Logs: .nx-mk/runs/${result.runId}/`)
    if (db) {
      // —— Phase 3（spec §3.5）：drain-once —— flush 与 analyzer 共用同一次 drain ——
      const drained = collector?.drain()
      if (drained) {
        // spec §4：flush SQLite 写入失败 = fail-fast（数据完整性优先于静默失败）
        db.flushDrained({ runId, ...drained })
        // 1. manifest 读取失败容忍（spec §4：goal-loop 已容忍此态）—— 缺失/解析失败 → 跳过分析
        let manifest: AnalyzeInput['manifest'] | undefined
        try {
          manifest = JSON.parse(readFileSync(join(cwd, '.nx-mk', 'manifest.json'), 'utf8'))
        } catch {
          /* warn 下移 */
        }
        if (manifest) {
          // 2. policy 决策 + analyzer（coverage 段经 passthrough 透出，收窄读取同 collect 段）
          const coverageCfg = (config as typeof config & { coverage?: CoverageConfig }).coverage ?? {}
          const decisions = evaluatePolicy(manifest.fields, coverageCfg)
          const report = analyzeCoverage({ runId, manifest, policyDecisions: decisions, drained, db })
          // 3. stdout 三指标摘要
          const pct = (n: number) => `${Math.round(n * 100)}%`
          console.log(
            `  Coverage: required ${pct(report.metrics.requiredCoverage)} | effective ${pct(report.metrics.effectiveCoverage)} | raw backend ${pct(report.metrics.rawBackendFieldCoverage)}`,
          )
          console.log(
            `  missing required: ${report.metrics.missingRequiredFields} | ignored returned: ${report.metrics.ignoredReturnedFields} | suspicious: ${report.metrics.suspiciousFields}`,
          )
          // 4. JSON 落盘（写失败 warn 不阻断 —— 报告是产物不是账本，coverage_fields 已落库）
          try {
            writeFileSync(join(cwd, '.nx-mk', 'coverage-report.json'), JSON.stringify(report, null, 2))
            console.log('  Report: .nx-mk/coverage-report.json')
          } catch (err) {
            console.warn(`coverage-report.json write failed: ${(err as Error).message}`)
          }
        } else {
          console.warn('coverage analysis skipped — .nx-mk/manifest.json unavailable')
        }
      } else if (collect) {
        // I1（Task 7 审查）：collect 配置而 flush 通道无 collector —— 防御性 warn。
        // Ruling 5 装配后 collect 存在即有共享实例，此行守护未来装配被破坏的场景
        // （静默空 flush —— db 存在但三表全空 —— 是验收调试的时间黑洞）。
        console.warn(
          'collect configured but no shared collector injected — evidence/trace data will not be persisted',
        )
      }
      // endRun 收尾（spec §3.5 顺序：analyzer 之后）；terminatedBy 来自 RunResult（§3.1 审计链）
      db.endRun(runId, new Date().toISOString(), 'completed', result.terminatedBy)
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
