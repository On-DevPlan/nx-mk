/**
 * DSL 场景回放历史读取（GET /api/scenarios/trails）：
 * 扫描 replays/scenarios 下按 scenarioId 分层的 *.json 留痕，逐文件形状门控
 * （replayId/scenarioId/ok/steps 齐全才收），按 createdAt 倒序、上限 100 条。
 * trail 写盘所有权在 @nx-mk/scenario（铁律：本包写白名单仍恰 replay.ts），此处只读。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ScenarioTrailStep, ScenarioTrailSummary } from '../../shared/api-types.js'

/** 单条 trail 文件的形状门控读取（列表与详情共用；不过 → null） */
function readTrailFile(path: string): ScenarioTrailSummary | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (isTrailShaped(parsed)) {
      return {
        replayId: parsed.replayId,
        scenarioId: parsed.scenarioId,
        ok: parsed.ok,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
        steps: parsed.steps,
      }
    }
  } catch { /* 损坏文件跳过（诚实降级） */ }
  return null
}

const MAX_TRAILS = 100

function isStepShaped(v: unknown): v is ScenarioTrailStep {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return typeof s.stepId === 'string' && typeof s.type === 'string'
    && typeof s.ok === 'boolean' && typeof s.durationMs === 'number'
}

function isTrailShaped(v: unknown): v is ScenarioTrailSummary {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return typeof t.replayId === 'string' && typeof t.scenarioId === 'string'
    && typeof t.ok === 'boolean' && Array.isArray(t.steps) && t.steps.every(isStepShaped)
}

export function readScenarioTrails(nxMkDir: string): ScenarioTrailSummary[] {
  const root = join(nxMkDir, 'replays', 'scenarios')
  if (!existsSync(root)) return []
  const trails: ScenarioTrailSummary[] = []
  // 目录按 scenarioId 分层；两遍遍历（外 scenarioId 目录，内 trail 文件）
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    if (!statSync(dir).isDirectory()) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json') || trails.length >= MAX_TRAILS) continue
      try {
        const trail = readTrailFile(join(dir, file))
        if (trail !== null) trails.push(trail)
      } catch { /* 损坏文件跳过（诚实降级） */ }
    }
  }
  return trails.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

/** 单条 trail 详情（GET /api/scenarios/trails/:replayId）：replayId 即文件名（去 .json），按 scenarioId 分层目录定位 */
export function readScenarioTrailDetail(nxMkDir: string, replayId: string): ScenarioTrailSummary | null {
  const root = join(nxMkDir, 'replays', 'scenarios')
  if (!existsSync(root) || replayId.includes('/') || replayId.includes('\\') || replayId.includes('..')) return null
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    if (!statSync(dir).isDirectory()) continue
    const file = join(dir, `${replayId}.json`)
    if (!existsSync(file)) continue
    return readTrailFile(file)
  }
  return null
}
