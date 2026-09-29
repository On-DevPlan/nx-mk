/**
 * GET /api/scenarios（spec S11）+ POST /api/runs/:runId/replay/scenario/:scenarioId（§27/S3/S12）。
 * 浏览器执行经 @nx-mk/scenario 高层入口（SP4 —— dashboard 零 playwright-core 依赖面）；
 * trail 写盘在 scenario 包（铁律：本目录白名单仍恰 replay.ts）。
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { loadScenarios, replayScenario, ScenarioReplayError, makeScenarioReplayId, writeScenarioReplayTrail, stepIdOf } from '@nx-mk/scenario'
import type { ScenarioStep } from '@nx-mk/scenario'
import { loadConfig } from '@nx-mk/config'
import { makeRunId } from '@nx-mk/kernel'
import type { ResolvedConfig } from '@nx-mk/kernel'
import type { ScenarioConfig } from '@nx-mk/config'
import type { ScenarioReplayResponse, ScenarioTrailDetailResponse, ScenariosResponse, ScenarioTrailsResponse } from '../../shared/api-types.js'
import { readScenarioTrailDetail, readScenarioTrails } from '../store/trail-reader.js'

// E6：模块级串行锁（单进程本地 dashboard 语义；try/finally 复位）
let inFlight = false

/** 从 configPath 读 scenarios.include（损坏/缺失 → undefined，S11 同族诚实降级） */
async function readInclude(ctx: RouteContext): Promise<string[] | undefined> {
  if (!ctx.configPath) return undefined
  try {
    const config = await loadConfig({ path: ctx.configPath, cwd: dirname(ctx.nxMkDir), runId: makeRunId('run_dashboard'), subcommand: 'start' })
    const resolved = config as ResolvedConfig & { scenarios?: ScenarioConfig }
    const include = resolved.scenarios?.include
    return include?.length ? [...include] : undefined
  } catch {
    // 配置损坏 → 浏览页诚实空态（S11 同族），不 500
    return undefined
  }
}

/** DSL 步骤 → 输入载荷（按类型取字段；与 runner.ts 的执行输入一一对应） */
function stepInput(step: ScenarioStep): Record<string, unknown> {
  switch (step.type) {
    case 'goto':
      return { url: step.url }
    case 'waitFor':
      return { selector: step.selector, ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}) }
    case 'waitForRequest':
      return { urlPattern: step.urlPattern, ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}) }
    case 'assertFieldVisible':
      return { field: step.field, ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}) }
    case 'screenshot':
      return step.path !== undefined ? { path: step.path } : {}
  }
}

export function registerScenarioRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/scenarios', async (): Promise<ScenariosResponse> => {
    const include = await readInclude(ctx)
    if (!include) return { enabled: false, scenarios: [] }
    const { scenarios } = loadScenarios(dirname(ctx.nxMkDir), include)
    return {
      enabled: true,
      scenarios: scenarios.map((s) => ({
        id: s.scenario.id,
        name: s.scenario.name,
        ...(s.scenario.route !== undefined ? { route: s.scenario.route } : {}),
        stepCount: s.scenario.steps.length,
        file: s.file,
      })),
    }
  })

  // 回放历史（DSL 驱动报告）：只读扫描 replays/scenarios/**.json，形状门控 + 倒序
  app.get('/api/scenarios/trails', async (): Promise<ScenarioTrailsResponse> => {
    return { trails: readScenarioTrails(ctx.nxMkDir) }
  })

  // 单条回放报告详情：执行结果（trail JSON）× DSL 输入（stepIdOf 按 index 对齐）合并 —— 「具体 I/O」
  app.get('/api/scenarios/trails/:replayId', async (req, reply): Promise<ScenarioTrailDetailResponse | void> => {
    const { replayId } = req.params as { replayId: string }
    const trail = readScenarioTrailDetail(ctx.nxMkDir, replayId)
    if (trail === null) {
      return reply.code(404).send({ error: `unknown trail: ${replayId}` })
    }
    // DSL 定义现读（与 GET /api/scenarios 同一 loader 语义）；不可得 → input 全 null、dslFile null（诚实降级）
    const include = await readInclude(ctx)
    const loaded = include ? loadScenarios(dirname(ctx.nxMkDir), include).scenarios.find((s) => s.scenario.id === trail.scenarioId) : undefined
    const inputByStepId = new Map<string, Record<string, unknown>>()
    if (loaded) {
      loaded.scenario.steps.forEach((step, i) => {
        inputByStepId.set(stepIdOf(loaded.scenario.id, step, i), stepInput(step))
      })
    }
    return {
      replayId: trail.replayId,
      scenarioId: trail.scenarioId,
      ok: trail.ok,
      createdAt: trail.createdAt,
      dslFile: loaded?.file ?? null,
      steps: trail.steps.map((s) => ({ ...s, input: inputByStepId.get(s.stepId) ?? null })),
    }
  })

  app.post('/api/runs/:runId/replay/scenario/:scenarioId', async (req, reply) => {
    const { runId, scenarioId } = req.params as { runId: string; scenarioId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    // 场景定位（每请求现读——GET 与 POST 共享同一 loader 语义）
    const include = await readInclude(ctx)
    const scenario = include ? loadScenarios(dirname(ctx.nxMkDir), include).scenarios.find((s) => s.scenario.id === scenarioId)?.scenario : undefined
    if (!scenario) return reply.code(404).send({ error: `unknown scenario: ${scenarioId}` })
    if (inFlight) return reply.code(409).send({ error: 'scenario replay already in progress' })
    inFlight = true
    try {
      const result = await replayScenario(scenario)
      const createdAt = new Date().toISOString()
      const trail = {
        replayId: makeScenarioReplayId(scenarioId),
        scenarioId,
        ok: result.ok,
        steps: result.steps,
        createdAt,
      }
      const written = writeScenarioReplayTrail(ctx.nxMkDir, trail)
      const res: ScenarioReplayResponse = { ...trail, trailWritten: written !== null }
      return res
    } catch (err) {
      if (err instanceof ScenarioReplayError) {
        return reply.code(err.code === 'CHROMIUM_MISSING' ? 409 : 500).send({ error: err.message, code: err.code })
      }
      throw err
    } finally {
      inFlight = false
    }
  })
}
