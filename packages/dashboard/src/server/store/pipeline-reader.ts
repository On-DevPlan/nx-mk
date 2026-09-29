/**
 * 流水线逐步报告读取（Pipeline 页数据源）：
 * - events.jsonl 逐行解析（形状门控：type 非字符串的行跳过，损坏行不致 500）
 * - phase:start/phase:end 配对成步骤；turn:end 投影覆盖快照；goal:met/unmet 投影终止判定；
 *   plugin:loaded/state-change 合并插件状态；scenario:start/done 配对 DSL 场景执行
 * - run 目录 manifest.json 投影 manifest 步骤（形状不过 → null，诚实降级）
 * 分析步骤由调用方经 reportForRun（D12 runId 门控）补充，本文件不读 coverage-report.json。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PipelineAnalysis,
  PipelineEventsResponse,
  PipelineGoal,
  PipelineManifest,
  PipelinePhaseStep,
  PipelinePlugin,
  PipelineReportResponse,
  PipelineScenarioStep,
  PipelineTurn,
} from '../../shared/api-types.js'
import { reportForRun } from './report-reader.js'

/** events.jsonl 逐行解析：损坏行跳过；只保留 type 为字符串的事件 */
function readEvents(runDir: string): Record<string, unknown>[] {
  let raw: string
  try {
    raw = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
  } catch {
    return []
  }
  const events: Record<string, unknown>[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>).type === 'string') {
        events.push(parsed as Record<string, unknown>)
      }
    } catch { /* 损坏行跳过 */ }
  }
  return events
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

export function readPipelineReport(nxMkDir: string, runId: string): PipelineReportResponse {
  const runDir = join(nxMkDir, 'runs', runId)
  const events = readEvents(runDir)
  const hasEventsFile = events.length > 0

  // —— phases：start/end 配对（同名 phase 可多次出现，按出现顺序消费 end）——
  const phases: PipelinePhaseStep[] = []
  const openPhases = new Map<string, { startedAt: string | null }[]>()
  for (const e of events) {
    const type = e.type as string
    if (type === 'phase:start') {
      const phase = str(e.phase)
      if (phase === null) continue
      const open = openPhases.get(phase) ?? []
      open.push({ startedAt: str(e.timestamp) })
      openPhases.set(phase, open)
    } else if (type === 'phase:end') {
      const phase = str(e.phase)
      if (phase === null) continue
      const open = openPhases.get(phase)?.shift()
      if (openPhases.get(phase)?.length === 0) openPhases.delete(phase)
      phases.push({ phase, startedAt: open?.startedAt ?? null, durationMs: num(e.durationMs) })
    }
  }
  // 未闭合的 phase（异常中断）也如实列出
  for (const [phase, open] of openPhases) {
    for (const o of open) phases.push({ phase, startedAt: o.startedAt, durationMs: null })
  }

  // —— plugins：loaded 提版本，state-change 提状态（后到覆盖）——
  const pluginMap = new Map<string, PipelinePlugin>()
  for (const e of events) {
    const name = str(e.name)
    if (name === null) continue
    if (e.type === 'plugin:loaded') {
      const prev = pluginMap.get(name)
      pluginMap.set(name, { name, version: str(e.version), state: prev?.state ?? null })
    } else if (e.type === 'plugin:state-change') {
      const prev = pluginMap.get(name)
      pluginMap.set(name, { name, version: prev?.version ?? null, state: str(e.to) })
    }
  }

  // —— turns：turn:end 快照（turn:start 仅补未结束轮次省略——v0 只报已结束轮）——
  const turns: PipelineTurn[] = []
  for (const e of events) {
    if (e.type !== 'turn:end') continue
    const turn = num(e.turn)
    if (turn === null) continue
    const cov = (typeof e.coverage === 'object' && e.coverage !== null ? e.coverage : {}) as Record<string, unknown>
    turns.push({
      turn,
      ratio: num(cov.ratio),
      covered: num(cov.covered),
      total: num(cov.total),
      progress: str(e.progress),
    })
  }

  // —— goal：最后一个 met/unmet 事件 ——
  let goal: PipelineGoal | null = null
  for (const e of events) {
    if (e.type !== 'goal:met' && e.type !== 'goal:unmet') continue
    const cov = (typeof e.coverage === 'object' && e.coverage !== null ? e.coverage : {}) as Record<string, unknown>
    goal = {
      status: e.type === 'goal:met' ? 'met' : 'unmet',
      ratio: num(cov.ratio),
      turns: num(e.turns),
      durationMs: num(e.durationMs),
    }
  }

  // —— scenarios（run 内 DSL 执行）：start/done 按 scenarioId 配对 ——
  const scenarioMap = new Map<string, PipelineScenarioStep>()
  const scenarioOrder: string[] = []
  for (const e of events) {
    const scenarioId = str(e.scenarioId)
    if (scenarioId === null) continue
    if (e.type === 'scenario:start') {
      if (!scenarioMap.has(scenarioId)) scenarioOrder.push(scenarioId)
      scenarioMap.set(scenarioId, { scenarioId, ok: null })
    } else if (e.type === 'scenario:done') {
      if (!scenarioMap.has(scenarioId)) scenarioOrder.push(scenarioId)
      scenarioMap.set(scenarioId, { scenarioId, ok: e.ok === true })
    }
  }
  const scenarios = scenarioOrder.map((id) => scenarioMap.get(id)!) // eslint-disable-line @typescript-eslint/no-non-null-assertion

  // —— analysis：D12 门控（report.runId ≠ 查询目标 → hasReport false）——
  const report = reportForRun(nxMkDir, runId)
  const analysis: PipelineAnalysis = report === null
    ? { hasReport: false, requiredCoverage: null, effectiveCoverage: null, rawBackendFieldCoverage: null }
    : {
        hasReport: true,
        requiredCoverage: report.metrics.requiredCoverage,
        effectiveCoverage: report.metrics.effectiveCoverage,
        rawBackendFieldCoverage: report.metrics.rawBackendFieldCoverage,
      }

  return {
    runId,
    phases: hasEventsFile || phases.length > 0 ? phases : null,
    plugins: [...pluginMap.values()],
    turns,
    goal,
    scenarios,
    analysis,
    manifest: readRunManifest(runDir),
  }
}

/** 原始事件透出上限（防巨型 run 拖垮响应；超出截断并标记） */
const MAX_RAW_EVENTS = 500

/**
 * events.jsonl 原始事件逐条 I/O（GET /api/runs/:runId/pipeline/events）：
 * 与聚合视图同一套逐行解析/形状门控，事件对象原样透出（含 timestamp/coverage/signal 等完整载荷）。
 */
export function readPipelineEvents(nxMkDir: string, runId: string): PipelineEventsResponse {
  const events = readEvents(join(nxMkDir, 'runs', runId))
  const truncated = events.length > MAX_RAW_EVENTS
  return { runId, events: truncated ? events.slice(0, MAX_RAW_EVENTS) : events, truncated }
}

/** run 目录 manifest.json 投影（形状不过 → null） */
function readRunManifest(runDir: string): PipelineManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const m = parsed as Record<string, unknown>
  const endpoints = Array.isArray(m.endpoints) ? m.endpoints.length : null
  const fields = Array.isArray(m.fields) ? m.fields.length : null
  if (endpoints === null && fields === null && typeof m.version !== 'string') return null
  const source = (typeof m.source === 'object' && m.source !== null ? m.source : {}) as Record<string, unknown>
  return {
    version: str(m.version),
    sourceType: str(source.type),
    endpoints,
    fields,
  }
}
