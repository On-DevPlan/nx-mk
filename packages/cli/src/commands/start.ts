/**
 * start 子命令 —— 一键启动本地 Dashboard + 分析（spec §3.6）
 *
 * 顺序：loadConfig（dashboard 段校验）→ buildServer → listen(127.0.0.1) →
 * 打印 URL →（open: true 默认）best-effort 打开浏览器 → 动态 import runMain 跑一次分析。
 * run 失败不关 server（spec §4）：catch 打印错误摘要，failed run 在页面可见；
 * 仅 listen 失败（EADDRINUSE 等）向上抛错（CLI 顶层映射非零退出码）。
 *
 * 测试缝（deps）：startServer / runOnce / openBrowser 可注入——
 * 测试不占真端口、不真跑 run、不真开浏览器。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { KernelError, makeRunId, type LogLevel } from '@nx-mk/kernel'
import { loadConfig, type DashboardConfig } from '@nx-mk/config'
import { buildServer, resolveUiDistDir } from '@nx-mk/dashboard'

export const DEFAULT_DASHBOARD_PORT = 4317

export interface StartMainOptions {
  configPath: string
  runId: string
  cwd?: string
  /** CLI --port 覆盖（优先级：CLI > config.dashboard.port > 4317） */
  port?: number
  /** CLI --no-run：只 serve 现有产物 */
  noRun?: boolean
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
  /** 测试缝：不注入则用真实实现 */
  deps?: StartDeps
}

export interface StartDeps {
  startServer: (port: number, host: string) => Promise<void>
  runOnce: () => Promise<void>
  openBrowser: (url: string) => void
}

export async function startMain(opts: StartMainOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  // 预检配置存在性（F2，对照 run.ts：loadConfig 对不可读文件抛 CONFIG_INVALID，
  // 显式 missing 应保持 CONFIG_NOT_FOUND 语义）
  if (!existsSync(opts.configPath)) {
    throw new KernelError('CONFIG_NOT_FOUND', `Config file not found: ${opts.configPath}`)
  }
  const config = await loadConfig({
    path: opts.configPath,
    cwd,
    runId: makeRunId(opts.runId),
    subcommand: 'start',
    ...(opts.cliOverrides ? { cliOverrides: opts.cliOverrides } : {}),
  })
  const dash: DashboardConfig = (config as typeof config & { dashboard?: DashboardConfig }).dashboard ?? {}
  const port = opts.port ?? dash.port ?? DEFAULT_DASHBOARD_PORT

  const server = buildServer({
    nxMkDir: join(cwd, '.nx-mk'),
    uiDistDir: resolveUiDistDir(),
  })

  const deps: StartDeps = opts.deps ?? {
    startServer: async (p, host) => {
      await server.listen({ port: p, host })
    },
    runOnce: async () => {
      const { runMain } = await import('./run.js')
      await runMain({
        configPath: opts.configPath,
        runId: opts.runId,
        cwd,
        ...(opts.cliOverrides ? { cliOverrides: opts.cliOverrides } : {}),
      })
    },
    openBrowser: openBrowserBestEffort,
  }

  const url = `http://127.0.0.1:${port}`
  try {
    await deps.startServer(port, '127.0.0.1')
  } catch (err) {
    if ((err as { code?: string }).code === 'EADDRINUSE') {
      throw new KernelError(
        'KERNEL_INTERNAL',
        `port ${port} in use — pass --port <n> or change dashboard.port`,
        err,
      )
    }
    throw err
  }
  console.log(`✔ Dashboard: ${url}`)
  console.log('  Data: .nx-mk/ (read-only)')
  if (dash.open !== false) deps.openBrowser(url)

  if (opts.noRun) {
    console.log('  (--no-run) serving existing artifacts only')
    return
  }
  console.log('  Running analysis… (server stays up if the run fails)')
  try {
    await deps.runOnce()
  } catch (err) {
    // run 失败保活（spec §4）：错误摘要后 server 继续服务，failed run 行在页面可见
    const message = err instanceof KernelError ? `${err.code}: ${err.message}` : (err as Error).message
    console.error(`✖ run failed — dashboard still serving at ${url}`)
    console.error(`  ${message}`)
  }
}

/** best-effort 开浏览器（spec §4）：spawn 平台命令，失败仅 warn */
function openBrowserBestEffort(url: string): void {
  try {
    const cmd = process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', url]
      : process.platform === 'darwin'
        ? ['open', url]
        : ['xdg-open', url]
    spawn(cmd[0]!, cmd.slice(1), { stdio: 'ignore', detached: true }).unref()
  } catch (err) {
    console.warn(`failed to open browser: ${(err as Error).message}`)
  }
}
