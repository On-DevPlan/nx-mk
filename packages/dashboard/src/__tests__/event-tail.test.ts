/**
 * event-tail 测试（Phase 4.5）：JSONL 追加 → 事件映射（V1 三类）/ 未知 type 跳过（R10）/
 * 损坏行跳过（E7）/ 残行等待补全 / 轮询降级等价（E6）/ runId 过滤 / SSE 端到端。
 *
 * 注意：brief 的 afterEach 是 `rmSync(dirname(dir), ...)`，但 dir = mkdtempSync(__dirname+...)，
 * 也就是 dir = __tests__/nx-mk-tail-XXXXXX，dirname(dir) = __tests__/。第一个测试结束会把
 * __tests__/ 删了，下一轮 beforeEach mkdtempSync 自然 ENOENT。修正：mkNxMk 返回 mkdtemp
 * 子目录里的 .nx-mk，dirname(dir) 就指向 mkdtemp 的根（每个测试独立、安全删）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, appendFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { EventTail, mapRawEvent, type TailEvent } from '../server/event-tail.js'
import { buildServer } from '../server/index.js'

const PHASE_START = JSON.stringify({ type: 'phase:start', phase: 'run', timestamp: '2026-09-20T10:00:00.000Z' })
const PHASE_END = JSON.stringify({ type: 'phase:end', phase: 'run', durationMs: 123 })
const TURN_END = JSON.stringify({ type: 'turn:end', turn: 2, progress: 'improved', coverage: { ratio: 0.5 } })
const TURN_START = JSON.stringify({ type: 'turn:start', turn: 1, idleTurns: 0 }) // 不在三类映射内
const PLUGIN_LOADED = JSON.stringify({ type: 'plugin:loaded', name: 'x', version: '1' }) // 同上

describe('mapRawEvent（V1 三类映射）', () => {
  it('phase:start → stage:start；phase:end → stage:done；turn:end → agent:iteration', () => {
    expect(mapRawEvent('r1', JSON.parse(PHASE_START))).toEqual({
      kind: 'stage:start', runId: 'r1', phase: 'run', timestamp: '2026-09-20T10:00:00.000Z',
    })
    expect(mapRawEvent('r1', JSON.parse(PHASE_END))).toEqual({
      kind: 'stage:done', runId: 'r1', phase: 'run', durationMs: 123,
    })
    expect(mapRawEvent('r1', JSON.parse(TURN_END))).toEqual({
      kind: 'agent:iteration', runId: 'r1', turn: 2, progress: 'improved', coverageRatio: 0.5,
    })
  })
  it('未知 type / 损坏行 / 非对象 → null（R10/E7）', () => {
    expect(mapRawEvent('r1', JSON.parse(TURN_START))).toBeNull()
    expect(mapRawEvent('r1', JSON.parse(PLUGIN_LOADED))).toBeNull()
    expect(mapRawEvent('r1', { type: 'future:event', x: 1 })).toBeNull()
    expect(mapRawEvent('r1', 'not-an-object')).toBeNull()
    expect(mapRawEvent('r1', null)).toBeNull()
  })
  it('turn:end 缺 coverage → coverageRatio null；缺 progress → unknown', () => {
    const e = mapRawEvent('r1', { type: 'turn:end', turn: 1 })
    expect(e).toEqual({ kind: 'agent:iteration', runId: 'r1', turn: 1, progress: 'unknown', coverageRatio: null })
  })
})

describe('EventTail（轮询路径，pollMs=10）', () => {
  let dir: string
  let eventsFile: string
  let tail: EventTail
  let seen: TailEvent[]

  beforeEach(() => {
    dir = mkNxMk()
    eventsFile = join(dir, 'runs', 'run_a', 'events.jsonl')
    seen = []
    tail = new EventTail({ nxMkDir: dir, pollMs: 10, useWatch: false }, (e) => seen.push(e))
  })
  afterEach(() => {
    tail.stop()
    // dir = <root>/.nx-mk；dirname(dir) = mkdtemp 的临时根（每测试独立、可删）
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  function mkNxMk(): string {
    const d = mkdtempSync(join(__dirname, 'nx-mk-tail-')) // 用仓库内 tmp，Windows tmpdir 路径太长时 watch 更稳
    const nx = join(d, '.nx-mk')
    mkdirSync(join(nx, 'runs', 'run_a'), { recursive: true })
    writeFileSync(join(nx, 'runs', 'run_a', 'events.jsonl'), '')
    return nx
  }

  it('start 后追加的完整行被增量推送；起点是当前 EOF（不重放历史）', async () => {
    appendFileSync(eventsFile, PHASE_START + '\n') // start 前的历史 → 不推
    tail.start()
    appendFileSync(eventsFile, PHASE_END + '\n' + TURN_END + '\n')
    await viWaitFor(() => seen.length >= 2)
    expect(seen.map((e) => e.kind)).toEqual(['stage:done', 'agent:iteration'])
  })

  it('损坏行与未知 type 不炸流（E7/R10）', async () => {
    tail.start()
    appendFileSync(eventsFile, '{broken json\n' + PLUGIN_LOADED + '\n' + PHASE_END + '\n')
    await viWaitFor(() => seen.length >= 1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.kind).toBe('stage:done')
  })

  it('残行：无换行结尾不推送，补全后推送一次', async () => {
    tail.start()
    appendFileSync(eventsFile, PHASE_END) // 无 \n
    await sleep(40)
    expect(seen).toHaveLength(0)
    appendFileSync(eventsFile, '\n') // 补全
    await viWaitFor(() => seen.length >= 1)
    expect(seen).toHaveLength(1)
  })

  it('runId 过滤只透传目标 run', async () => {
    mkdirSync(join(dir, 'runs', 'run_b'), { recursive: true })
    writeFileSync(join(dir, 'runs', 'run_b', 'events.jsonl'), '')
    const filtered = new EventTail({ nxMkDir: dir, pollMs: 10, useWatch: false, runId: 'run_a' }, (e) => seen.push(e))
    tail.stop()
    tail = filtered
    filtered.start()
    appendFileSync(join(dir, 'runs', 'run_b', 'events.jsonl'), PHASE_END + '\n')
    appendFileSync(eventsFile, TURN_END + '\n')
    await viWaitFor(() => seen.length >= 1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.kind).toBe('agent:iteration')
  })

  it('runs 目录缺席时 start 不炸，目录后建仍被轮询捕获（E6 降级等价）', async () => {
    rmSync(join(dir, 'runs'), { recursive: true, force: true })
    const t = new EventTail({ nxMkDir: dir, pollMs: 10, useWatch: false }, (e) => seen.push(e))
    tail.stop()
    tail = t
    t.start()
    mkdirSync(join(dir, 'runs', 'run_c'), { recursive: true })
    appendFileSync(join(dir, 'runs', 'run_c', 'events.jsonl'), PHASE_END + '\n')
    await viWaitFor(() => seen.length >= 1)
    expect(seen[0]!.kind).toBe('stage:done')
  })
})

describe('GET /api/events（SSE 端到端，真 listen）', () => {
  it('fixture events.jsonl 追加 → 客户端收到 data 行', async () => {
    const d = mkdtempSync(join(__dirname, 'nx-mk-sse-'))
    const nx = join(d, '.nx-mk')
    mkdirSync(join(nx, 'runs', 'run_a'), { recursive: true })
    writeFileSync(join(nx, 'runs', 'run_a', 'events.jsonl'), '')
    const app = buildServer({ nxMkDir: nx, uiDistDir: join(d, 'ui') })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`

    const controller = new AbortController()
    const res = await fetch(`${base}/api/events?runId=run_a`, { signal: controller.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // retry 行先到
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const first = await reader.read()
    expect(decoder.decode(first.value)).toContain('retry: 2000')

    appendFileSync(join(nx, 'runs', 'run_a', 'events.jsonl'), PHASE_END + '\n')
    let dataLine = ''
    for (let i = 0; i < 50 && !dataLine; i++) {
      const chunk = await reader.read()
      if (chunk.done) break
      const text = decoder.decode(chunk.value)
      const m = text.split('\n').find((l) => l.startsWith('data: '))
      if (m) dataLine = m
    }
    expect(JSON.parse(dataLine.slice('data: '.length))).toEqual({
      kind: 'stage:done', runId: 'run_a', phase: 'run', durationMs: 123,
    })
    controller.abort()
    await app.close()
    rmSync(d, { recursive: true, force: true })
  }, 15_000)
})

// —— 小工具：轮询等待 + 睡眠（node 环境无 vi.useFakeTimers 的 stream 兼容问题，用真实短等待）——
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
async function viWaitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return
    await sleep(10)
  }
  throw new Error('viWaitFor timeout')
}