/**
 * replay 子命令（plan §9 命令清单「npx mk replay — 复现请求或场景」）：
 * - replay request <runId> <requestId> [--confirm]：report 摘要定位 trace → 与 dashboard
 *   同源的安全分类（classifyReplay，规则来自 config replay: 段）→ fetch 复刻 → 留痕（同一实现）。
 * - replay scenario <scenarioId>：config scenarios.include 加载 DSL → 浏览器回放 → 留痕。
 * blocked / 未知目标 → RUN_NOT_FOUND（前置产物缺失语义，退出码 2）；需确认未 --confirm → KERNEL_INTERNAL 提示。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KernelError, makeRunId } from '@nx-mk/kernel'
import { loadConfig, ReplayConfigSchema, type ReplayConfig } from '@nx-mk/config'
import {
  classifyReplay,
  performReplay,
  writeReplayTrail,
  makeReplayId,
  type ReplayRules,
} from '@nx-mk/dashboard'
import {
  loadScenarios,
  replayScenario,
  makeScenarioReplayId,
  writeScenarioReplayTrail,
  ScenarioReplayError,
  type ScenarioReplayTrail,
} from '@nx-mk/scenario'

export interface ReplayMainOptions {
  kind?: 'request' | 'scenario'
  /** kind 后的位置参数：request → [runId, requestId]；scenario → [scenarioId] */
  args?: string[]
  configPath: string
  confirm?: boolean
  cwd?: string
}

/** report JSON requests 摘要的最小形状（与 coverage RequestTraceSummary 兼容） */
interface ReportRequestsFile {
  requests?: { requestId?: string; method?: string; url?: string }[]
}

export async function replayMain(opts: ReplayMainOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  // config 只 load 一次（runId 仅作 loader 形参，不落任何 run 产物）
  const runId = makeRunId(`replay_${Date.now()}`)
  const config = await loadConfig({ path: opts.configPath, cwd, runId, subcommand: 'replay' })
  const replayCfg: ReplayConfig | undefined = (config as typeof config & { replay?: ReplayConfig }).replay
  const rules = toReplayRules(replayCfg)
  if (opts.kind === 'request') return replayRequestCmd(opts, cwd, rules)
  if (opts.kind === 'scenario') return replayScenarioCmd(opts, cwd, config)
  throw new KernelError(
    'KERNEL_INTERNAL',
    'replay requires a target: `nx-mk replay request <runId> <requestId>` or `nx-mk replay scenario <scenarioId>`',
  )
}

/** config replay: 段 → dashboard ReplayRules（schema 收窄校验；block[].pattern 摊平） */
function toReplayRules(replay: ReplayConfig | undefined): ReplayRules | undefined {
  if (!replay) return undefined
  const parsed = ReplayConfigSchema.safeParse(replay)
  if (!parsed.success) {
    throw new KernelError('CONFIG_INVALID', `replay config invalid: ${parsed.error.message}`)
  }
  const cfg = parsed.data
  return {
    ...(cfg.allowMethods !== undefined ? { allowMethods: cfg.allowMethods } : {}),
    ...(cfg.requireConfirmation !== undefined ? { requireConfirmation: cfg.requireConfirmation } : {}),
    ...(cfg.block !== undefined ? { blockPatterns: cfg.block.map((b) => b.pattern) } : {}),
  }
}

async function replayRequestCmd(opts: ReplayMainOptions, cwd: string, rules: ReplayRules | undefined): Promise<void> {
  const [runId, requestId] = opts.args ?? []
  if (!runId || !requestId) {
    throw new KernelError('KERNEL_INTERNAL', 'usage: nx-mk replay request <runId> <requestId> [--confirm]')
  }
  const reportPath = join(cwd, '.nx-mk', 'coverage-report.json')
  if (!existsSync(reportPath)) {
    throw new KernelError('RUN_NOT_FOUND', `coverage report not found: ${reportPath} — run \`nx-mk run\` first`)
  }
  let trace: { method?: string; url?: string } | undefined
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ReportRequestsFile
    trace = report.requests?.find((r) => r.requestId === requestId)
  } catch (err) {
    throw new KernelError('RUN_NOT_FOUND', `coverage report unreadable: ${(err as Error).message}`)
  }
  if (!trace?.method || !trace.url) {
    throw new KernelError('RUN_NOT_FOUND', `unknown request: ${requestId} (run ${runId})`)
  }
  // 与 dashboard replay 路由同源的安全三分类（规则来自 config replay: 段，缺省 = 内置默认）
  const cls = classifyReplay(trace.method, trace.url, rules)
  if (cls.verdict === 'blocked') {
    throw new KernelError('RUN_NOT_FOUND', `replay blocked: ${cls.reason}`)
  }
  if (cls.verdict !== 'safe' && opts.confirm !== true) {
    throw new KernelError(
      'KERNEL_INTERNAL',
      `${cls.verdict} method ${trace.method} requires confirmation — re-run with --confirm`,
    )
  }
  const key = cls.verdict === 'idempotent' ? `replay-${runId}-${requestId}-${Date.now()}` : null
  const outcome = await performReplay(trace.method, trace.url, key)
  writeReplayTrail(join(cwd, '.nx-mk'), {
    replayId: makeReplayId(requestId),
    runId,
    requestId,
    verdict: cls.verdict,
    reason: cls.reason,
    createdAt: new Date().toISOString(),
    request: { method: trace.method, url: trace.url, headers: key ? { 'idempotency-key': key } : {}, reqBody: '' },
    response: {
      ok: outcome.ok,
      status: outcome.status,
      durationMs: outcome.durationMs,
      bodyPreview: outcome.bodyPreview,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    },
  })
  console.log(`✔ Replay ${trace.method} ${trace.url} (verdict: ${cls.verdict})`)
  console.log(`  Status: ${outcome.status} in ${outcome.durationMs}ms`)
  if (outcome.bodyPreview) console.log(`  Preview: ${outcome.bodyPreview.slice(0, 200)}`)
}

async function replayScenarioCmd(opts: ReplayMainOptions, cwd: string, config: Awaited<ReturnType<typeof loadConfig>>): Promise<void> {
  const [scenarioId] = opts.args ?? []
  if (!scenarioId) {
    throw new KernelError('KERNEL_INTERNAL', 'usage: nx-mk replay scenario <scenarioId>')
  }
  // scenarios 段读取（与 run 命令同款收窄）；场景 step 全 read-only（spec S12 恒 safe）
  const scenariosCfg = (config as typeof config & { scenarios?: { include?: string[] } }).scenarios
  if (!scenariosCfg?.include || scenariosCfg.include.length === 0) {
    throw new KernelError('CONFIG_INVALID', 'scenarios.include not configured — add scenario globs to nx-mk.config.yml')
  }
  const { scenarios } = loadScenarios(cwd, scenariosCfg.include)
  const found = scenarios.find((s) => s.scenario.id === scenarioId)
  if (!found) {
    throw new KernelError(
      'RUN_NOT_FOUND',
      `unknown scenario: ${scenarioId} (loaded ${scenarios.length} from scenarios.include)`,
    )
  }
  let result
  try {
    result = await replayScenario(found.scenario)
  } catch (err) {
    if (err instanceof ScenarioReplayError) {
      throw new KernelError('PROVIDER_UNAVAILABLE', `${err.code}: ${err.message}`)
    }
    throw err
  }
  const trail: ScenarioReplayTrail = {
    replayId: makeScenarioReplayId(found.scenario.id),
    scenarioId: found.scenario.id,
    ok: result.ok,
    steps: result.steps,
    createdAt: new Date().toISOString(),
  }
  const written = writeScenarioReplayTrail(join(cwd, '.nx-mk'), trail)
  console.log(`✔ Scenario ${found.scenario.id}: ${result.ok ? 'PASSED' : 'FAILED'} (${result.steps.length} steps)`)
  for (const s of result.steps) {
    console.log(`  - ${s.stepId}: ${s.ok ? 'ok' : `fail${s.error ? ` — ${s.error}` : ''}`}`)
  }
  if (written) console.log(`  Trail: .nx-mk/replays/scenarios/${found.scenario.id}/${written}.json`)
}
