/**
 * GET /api/scenarios（spec S11）+ POST /api/runs/:runId/replay/scenario/:scenarioId（§27/S3/S12）。
 * 浏览器执行经 @nx-mk/scenario 高层入口（SP4 —— dashboard 零 playwright-core 依赖面）；
 * trail 写盘在 scenario 包（铁律：本目录白名单仍恰 replay.ts）。
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { loadScenarios, replayScenario, ScenarioReplayError, makeScenarioReplayId, writeScenarioReplayTrail } from '@nx-mk/scenario'
import { loadConfig } from '@nx-mk/config'
import { makeRunId } from '@nx-mk/kernel'
import type { ResolvedConfig } from '@nx-mk/kernel'
import type { ScenarioConfig } from '@nx-mk/config'
import type { ScenarioReplayResponse, ScenariosResponse } from '../../shared/api-types.js'

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
