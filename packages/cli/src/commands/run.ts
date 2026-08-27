/**
 * run 子命令 —— 以完整 5 阶段生命周期启动内核（默认子命令）
 *
 * 创建内核并调用 api.run()：loadConfig → resolvePlugins → initPlugins
 * → run → shutdown；成功后打印运行 ID、耗时与产物目录位置。
 */
import { createKernel, makeRunId, type LogLevel } from '@nx-mk/kernel'

// run 子命令入参：配置路径 + 运行 ID + CLI 级配置覆盖
export interface RunMainOptions {
  configPath: string
  runId: string
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
}

// 创建内核（cwd 取当前进程目录）并驱动完整生命周期；错误向上抛给 CLI 顶层处理
export async function runMain(opts: RunMainOptions): Promise<void> {
  const kernel = createKernel({
    configPath: opts.configPath,
    runId: makeRunId(opts.runId),
    subcommand: 'run',
    cwd: process.cwd(),
  })
  const result = await kernel.run()
  console.log(`✔ Run ${result.runId} completed in ${result.durationMs}ms`)
  console.log(`  Logs: .nx-mk/runs/${result.runId}/`)
}