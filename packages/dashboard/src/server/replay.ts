/**
 * Replay Request（Phase 4.5 spec R1-R5）：服务端安全三分类 → fetch 复刻 → .nx-mk/replays/ 留痕。
 * R1 分类在服务端做；R3 不写 coverage.db、不触发重采集；R4 网络失败 → 200 replay-error；
 * R5 留痕含 verdict + 请求快照（reqBody 截断）+ 响应摘要。
 * V3 裁定：复刻只带 method+url（traces 不存原始 body/headers）；PUT 由 server 生成
 * idempotency-key 头，故 PUT 归 idempotent；V4 裁定：idempotent 与 unsafe 同样要 confirm。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReplayVerdict } from '../shared/api-types.js'

/** 敏感路径词表（plan §27.2「payment/delete 等敏感路径 => blocked」的 v0 实现） */
const SENSITIVE_PATH_RE = /payment|refund|payout|withdraw/i
const REPLAY_TIMEOUT_MS = 10_000
const PREVIEW_LIMIT = 500

export interface ReplayClassification {
  verdict: ReplayVerdict
  reason: string
}

/** R1：分类纯函数 —— blocked 压过 method 规则 */
export function classifyReplay(method: string, url: string): ReplayClassification {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    /* 畸形 URL 按原文判别 */
  }
  if (SENSITIVE_PATH_RE.test(path)) {
    return { verdict: 'blocked', reason: `sensitive path matched /${SENSITIVE_PATH_RE.source}/` }
  }
  if (method === 'GET' || method === 'HEAD') return { verdict: 'safe', reason: 'read-only method' }
  if (method === 'PUT') return { verdict: 'idempotent', reason: 'PUT replayed with generated idempotency-key' }
  return { verdict: 'unsafe', reason: `${method} is not idempotent` }
}

export interface ReplayOutcome {
  ok: boolean
  status: number | 'replay-error'
  durationMs: number
  bodyPreview: string | null
  error?: string
}

/** fetch 复刻（10s 超时；PUT 生成幂等键）；网络层失败 → replay-error（R4），不抛 */
export async function performReplay(method: string, url: string, idempotencyKey: string | null): Promise<ReplayOutcome> {
  const startedAt = Date.now()
  const headers: Record<string, string> = idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}
  try {
    const res = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
    })
    const text = await res.text()
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      bodyPreview: text.slice(0, PREVIEW_LIMIT),
    }
  } catch (err) {
    return {
      ok: false,
      status: 'replay-error',
      durationMs: Date.now() - startedAt,
      bodyPreview: null,
      error: (err as Error).message,
    }
  }
}

export interface ReplayTrail {
  replayId: string
  runId: string
  requestId: string
  verdict: ReplayVerdict
  reason: string
  createdAt: string
  request: { method: string; url: string; headers: Record<string, string>; reqBody: string }
  response: { ok: boolean; status: number | 'replay-error'; durationMs: number; bodyPreview: string | null; error?: string }
}

export function makeReplayId(requestId: string): string {
  return `${requestId}-${Date.now()}`
}

/** 留痕写盘（R2 铁律收缩项：dashboard server 唯一写路径）；失败返回 null 不影响响应 */
export function writeReplayTrail(nxMkDir: string, trail: ReplayTrail): string | null {
  try {
    const dir = join(nxMkDir, 'replays', trail.runId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${trail.replayId}.json`), JSON.stringify(trail, null, 2), 'utf8')
    return trail.replayId
  } catch {
    return null
  }
}

export interface ReplayTrailSummary {
  replayId: string
  verdict: ReplayVerdict
  ok: boolean
  status: number | 'replay-error' | null
  createdAt: string
}

/** 留痕列表：损坏文件跳过（与 SSE E7 同族语义），createdAt 降序 */
export function listReplays(nxMkDir: string, runId: string): ReplayTrailSummary[] {
  const dir = join(nxMkDir, 'replays', runId)
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: ReplayTrailSummary[] = []
  for (const f of files) {
    try {
      const t = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Partial<ReplayTrail>
      if (typeof t.replayId !== 'string' || typeof t.verdict !== 'string') continue
      out.push({
        replayId: t.replayId,
        verdict: t.verdict as ReplayVerdict,
        ok: t.response?.ok === true,
        status: t.response?.status ?? null,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
      })
    } catch {
      /* 损坏留痕跳过 */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}