/**
 * loop 子命令（spec §3.9）—— 消费 .nx-mk/coverage-report.json 跑 Agent Loop。
 * 装配层：createClaudeCodeProvider + 内置两 agent 构造后注入 runAgentLoop；
 * deps.runLoop 为测试缝（对齐 start.ts 的 StartDeps），CLI 测试不 spawn 真 claude。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KernelError, makeRunId, type LogLevel } from '@nx-mk/kernel'
import { loadConfig, type AgentConfig } from '@nx-mk/config'
import {
  AGENT_DEFAULTS,
  createApiUiAgent,
  createClaudeCodeProvider,
  createReviewAgent,
  runAgentLoop,
  type CoverageReport,
  type LoopSummary,
} from '@nx-mk/agent'

export interface LoopCliDeps {
  runLoop: typeof runAgentLoop
}

export interface LoopMainOptions {
  configPath: string
  cwd?: string
  /** CLI --max-iterations 覆盖（优先级：CLI > config.agent.loop.maxIterations > 5） */
  maxIterations?: number
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
  /** 测试缝：不注入则用真实实现 */
  deps?: LoopCliDeps
}

// 报告形状门（spec §3.2）：runId + metrics.requiredCoverage 存在；不过 → RUN_NOT_FOUND（E1）
function readCoverageReport(nxMkDir: string): CoverageReport {
  const reportPath = join(nxMkDir, 'coverage-report.json')
  if (!existsSync(reportPath)) {
    throw new KernelError('RUN_NOT_FOUND', `coverage report not found at ${reportPath} — run 'nx-mk run' first`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (err) {
    throw new KernelError('RUN_NOT_FOUND', `coverage report at ${reportPath} is not valid JSON — run 'nx-mk run' first`, err)
  }
  const r = raw as Partial<CoverageReport>
  if (!r || typeof r.runId !== 'string' || typeof r.metrics?.requiredCoverage !== 'number') {
    throw new KernelError('RUN_NOT_FOUND', `coverage report at ${reportPath} has an unexpected shape — run 'nx-mk run' first`)
  }
  return r as CoverageReport
}

// ratio → 百分比文本（对齐 run.ts 的 pct 摘要风格）
function pct(ratio: number): string {
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`
}

export async function loopMain(opts: LoopMainOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  // 预检配置存在性（E2，对齐 start.ts：显式 missing 保持 CONFIG_NOT_FOUND 语义）
  if (!existsSync(opts.configPath)) {
    throw new KernelError('CONFIG_NOT_FOUND', `Config file not found: ${opts.configPath}`)
  }
  const config = await loadConfig({
    path: opts.configPath,
    cwd,
    runId: makeRunId('loop'),
    subcommand: 'loop',
    ...(opts.cliOverrides ? { cliOverrides: opts.cliOverrides } : {}),
  })
  // config.agent 段：kernel Config 无此字段 → cast（对齐 start.ts 的 dashboard cast，PLN-3）
  const agentCfg: AgentConfig = (config as typeof config & { agent?: AgentConfig }).agent ?? {}
  // CLI 覆盖合并：--max-iterations > config.agent.loop.maxIterations
  // （无 loop 配置且无 CLI 覆盖时不添 loop 键 —— mergedCfg 与 config.agent 逐字一致）
  const loopCfg = { ...agentCfg.loop, ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}) }
  const mergedCfg: AgentConfig = { ...agentCfg, ...(Object.keys(loopCfg).length > 0 ? { loop: loopCfg } : {}) }

  const report = readCoverageReport(join(cwd, '.nx-mk'))

  const deps = opts.deps ?? { runLoop: runAgentLoop }
  const summary: LoopSummary = await deps.runLoop(
    { projectRoot: cwd, report, config: mergedCfg, log: (msg) => console.log(msg) },
    {
      provider: createClaudeCodeProvider({
        projectRoot: cwd,
        timeoutMs: agentCfg.provider?.timeoutMs ?? AGENT_DEFAULTS.provider.timeoutMs,
        maxTurns: agentCfg.provider?.maxTurns ?? AGENT_DEFAULTS.provider.maxTurns,
      }),
      apiUiAgent: createApiUiAgent(),
      reviewAgent: createReviewAgent(),
    },
  )

  // stdout 摘要（spec §3.9，英文）
  console.log(`Agent loop completed: ${summary.agentRunId}`)
  console.log(
    `  iterations: ${summary.iterations}  produced: ${summary.produced}  rejected: ${summary.rejected}` +
    `  failed: ${summary.failed}  given-up: ${summary.givenUp}  (stopped by: ${summary.stoppedBy})`,
  )
  console.log(`  report runId: ${report.runId} (requiredCoverage ${pct(report.metrics.requiredCoverage)})`)
  console.log(`  patches: ${summary.patchDir}/`)
  console.log(`  next: git apply ${summary.patchDir}/*.patch && nx-mk run`)
}
