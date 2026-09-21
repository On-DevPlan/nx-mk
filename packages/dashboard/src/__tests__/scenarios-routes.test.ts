/**
 * GET /api/scenarios（S11 降级）+ POST replay/scenario 矩阵（E4/E6/E7 + SP8）。
 * 真浏览器不在单测域：replayScenario 经 vi.mock('@nx-mk/scenario') 部分替换（见下）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { FastifyInstance } from 'fastify'

// 部分替换：loadScenarios/ScenarioReplayError 保持真实现（读盘/instanceof 门），replayScenario 换假
vi.mock('@nx-mk/scenario', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx-mk/scenario')>()
  return {
    ...actual,
    replayScenario: vi.fn(),
  }
})

const { buildServer } = await import('../server/index.js')
const { replayScenario, ScenarioReplayError } = await import('@nx-mk/scenario')
import { makeNxMkDir } from './fixtures.js'
import type { ScenariosResponse, ScenarioReplayResponse } from '../shared/api-types.js'

const SCEN_YAML = `version: 1
scenarios:
  - id: s-ok
    name: ok 场景
    route: /users/1
    steps:
      - type: goto
        url: /users/1
      - type: assertFieldVisible
        field: user.name
`

const SCEN_CONFIG = 'scenarios:\n  include:\n    - "mk/scenarios/**/*.yml"\n'
const REPLAYS_DIR = (nx: string) => join(nx, 'replays', 'scenarios')

interface Ctx {
  dir: string
  configPath: string
  app: FastifyInstance
  restore: () => void
}

/** 搭 tmp：.nx-mk（含 run_a）+ mk/scenarios/s.yml + 配置文件；返回可复用的基建 */
function setup(): Omit<Ctx, 'app' | 'restore'> {
  const dir = makeNxMkDir([{ runId: 'run_a' }])
  const configPath = join(dirname(dir), 'nx-mk.config.yml')
  mkdirSync(join(dirname(dir), 'mk/scenarios'), { recursive: true })
  writeFileSync(join(dirname(dir), 'mk/scenarios/s.yml'), SCEN_YAML, 'utf8')
  return { dir, configPath }
}

function build(ctx: { dir: string; configPath?: string }): FastifyInstance {
  return buildServer({ nxMkDir: ctx.dir, uiDistDir: join(ctx.dir, 'ui'), ...(ctx.configPath !== undefined ? { configPath: ctx.configPath } : {}) })
}

describe('GET /api/scenarios（S11）', () => {
  let base: ReturnType<typeof setup>

  beforeEach(() => {
    base = setup()
  })
  afterEach(() => {
    rmSync(dirname(base.dir), { recursive: true, force: true })
  })

  it('有 scenarios 段 → enabled + 场景列表（id/name/route/stepCount/file）', async () => {
    writeFileSync(base.configPath, SCEN_CONFIG, 'utf8')
    const app = build(base)
    try {
      const res = await app.inject({ method: 'GET', url: '/api/scenarios' })
      expect(res.statusCode).toBe(200)
      const body = res.json() as ScenariosResponse
      expect(body.enabled).toBe(true)
      expect(body.scenarios).toHaveLength(1)
      expect(body.scenarios[0]).toMatchObject({ id: 's-ok', name: 'ok 场景', route: '/users/1', stepCount: 2 })
    } finally {
      await app.close()
    }
  })

  it('configPath 未接线 → {enabled:false, scenarios:[]}', async () => {
    const app = build({ dir: base.dir })
    try {
      const res = await app.inject({ method: 'GET', url: '/api/scenarios' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ enabled: false, scenarios: [] })
    } finally {
      await app.close()
    }
  })

  it('有 configPath 无 scenarios 段 → 同降级形状', async () => {
    writeFileSync(base.configPath, 'logLevel: info\n', 'utf8')
    const app = build(base)
    try {
      const res = await app.inject({ method: 'GET', url: '/api/scenarios' })
      expect(res.json()).toEqual({ enabled: false, scenarios: [] })
    } finally {
      await app.close()
    }
  })

  it('loadConfig 失败（配置损坏）→ 同降级形状 + 200（诚实空态，不 500）', async () => {
    writeFileSync(base.configPath, 'plugins: [unclosed', 'utf8')
    const app = build(base)
    try {
      const res = await app.inject({ method: 'GET', url: '/api/scenarios' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ enabled: false, scenarios: [] })
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/runs/:runId/replay/scenario/:scenarioId', () => {
  let base: ReturnType<typeof setup>
  let corruptedRestore: typeof process.env.nx_mk_OUTPUT_DIR

  /** 全量基建（setup + scenarios 配置段 + 服务器） */
  async function buildFull(): Promise<FastifyInstance> {
    writeFileSync(base.configPath, SCEN_CONFIG, 'utf8')
    return build(base)
  }

  beforeEach(async () => {
    base = setup()
    // 隔离环境变量覆盖（loader 的 nx_mk_OUTPUT_DIR 会穿透到 loadConfig）
    corruptedRestore = process.env.nx_mk_OUTPUT_DIR
    delete process.env.nx_mk_OUTPUT_DIR
  })
  afterEach(async () => {
    if (corruptedRestore !== undefined) process.env.nx_mk_OUTPUT_DIR = corruptedRestore
    else delete process.env.nx_mk_OUTPUT_DIR
    vi.mocked(replayScenario).mockReset()
    rmSync(dirname(base.dir), { recursive: true, force: true })
  })

  it('全链：200 + 步骤级结果 + trailWritten=true + .nx-mk/replays/scenarios/ 落盘（SP8）', async () => {
    vi.mocked(replayScenario).mockResolvedValue({
      scenarioId: 's-ok',
      ok: true,
      steps: [{ stepId: 's-ok-step-0', type: 'goto', ok: true, durationMs: 4 }],
    })
    const app = await buildFull()
    try {
      const res = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
      expect(res.statusCode).toBe(200)
      const body = res.json() as ScenarioReplayResponse
      expect(body.ok).toBe(true)
      expect(body.steps[0]!.stepId).toBe('s-ok-step-0')
      expect(body.trailWritten).toBe(true)
      expect(body.replayId).toContain('s-ok')
      // SP8：trail 文件落盘
      const files = join(REPLAYS_DIR(base.dir), 's-ok')
      expect(existsSync(files)).toBe(true)
      expect(Object.keys(JSON.parse(readFileSync(join(files, `${body.replayId}.json`), 'utf8')))).toContain('steps')
    } finally {
      await app.close()
    }
  })

  it('E7 场景不存在 → 404 unknown scenario：', async () => {
    const app = await buildFull()
    try {
      const res = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/ghost' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'unknown scenario: ghost' })
    } finally {
      await app.close()
    }
  })

  it('E6 进行中 → 409（用不 resolve 的 promise 占住锁）', async () => {
    let release!: (value: unknown) => void
    vi.mocked(replayScenario).mockImplementation(
      () =>
        new Promise((r) => {
          release = r as (value: unknown) => void
        }),
    )
    const app = await buildFull()
    try {
      const first = app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
      // 等第一个请求真正进入 inFlight（vitest 宏视野内的软等待）
      await new Promise((r) => setTimeout(r, 20))
      const second = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
      expect(second.statusCode).toBe(409)
      expect(second.json()).toMatchObject({ error: 'scenario replay already in progress' })
      release({ scenarioId: 's-ok', ok: true, steps: [{ stepId: 's-ok-step-0', type: 'goto', ok: true, durationMs: 1 }] })
      expect((await first).statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('E4 chromium 缺失 → 409（ScenarioReplayError CHROMIUM_MISSING）', async () => {
    vi.mocked(replayScenario).mockRejectedValue(new ScenarioReplayError('CHROMIUM_MISSING', 'no chromium'))
    const app = await buildFull()
    try {
      const res = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
      expect(res.statusCode).toBe(409)
    } finally {
      await app.close()
    }
  })

  it('LAUNCH_FAILED → 500', async () => {
    vi.mocked(replayScenario).mockRejectedValue(new ScenarioReplayError('LAUNCH_FAILED', 'x'))
    const app = await buildFull()
    try {
      const res = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
      expect(res.statusCode).toBe(500)
      // 锁复位（try/finally）——后续请求不再 409
      vi.mocked(replayScenario).mockResolvedValue({ scenarioId: 's-ok', ok: true, steps: [] })
      const next = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
      expect(next.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('run 不存在 → 404 unknown run', async () => {
    vi.mocked(replayScenario).mockResolvedValue({ scenarioId: 's-ok', ok: true, steps: [] })
    const app = await buildFull()
    try {
      const res = await app.inject({ method: 'POST', url: '/api/runs/ghost_run/replay/scenario/s-ok' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'unknown run: ghost_run' })
    } finally {
      await app.close()
    }
  })
})
