/**
 * events.jsonl 文件 tail（Phase 4.5 spec R9/E6/E7）：fs.watch(runs, {recursive:true})
 * 驱动增量 drain；watch 不可用/出错降级 500ms 轮询——行为等价。
 * V1 裁定：SSE 三类映射 stage:start←phase:start、stage:done←phase:end、
 * agent:iteration←turn:end；request:captured 无内核实时源（采集走
 * collector→report→analyzer 管道，不经事件总线），推 Phase 6 RunState。
 * 起点 = 各文件当前 EOF（live-only，不重放历史）；残行等补全；损坏行跳过（E7）；
 * 未知 type 忽略（R10）。
 */
import { watch, existsSync, readdirSync, readFileSync, statSync, type FSWatcher } from 'node:fs'
import { join, relative } from 'node:path'

/** SSE 事件（spec U4 的 v0 三类；request:captured 见文件头 V1 裁定） */
export type TailEvent =
  | { kind: 'stage:start'; runId: string; phase: string; timestamp: string }
  | { kind: 'stage:done'; runId: string; phase: string; durationMs: number }
  | { kind: 'agent:iteration'; runId: string; turn: number; progress: string; coverageRatio: number | null }

export interface EventTailOptions {
  nxMkDir: string
  /** 降级轮询间隔（默认 500ms；测试注小值） */
  pollMs?: number
  /** 测试缝：false 强制轮询路径（跳过 watch） */
  useWatch?: boolean
  /** 只透传该 run 的事件（缺省全部） */
  runId?: string
}

type RawKernelEvent = { type?: unknown; [k: string]: unknown }

/** JSONL 原始行（已 JSON.parse）→ SSE 事件；不映射/形状残缺 → null */
export function mapRawEvent(runId: string, raw: unknown): TailEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as RawKernelEvent
  switch (e.type) {
    case 'phase:start':
      if (typeof e.phase !== 'string' || typeof e.timestamp !== 'string') return null
      return { kind: 'stage:start', runId, phase: e.phase, timestamp: e.timestamp }
    case 'phase:end':
      if (typeof e.phase !== 'string' || typeof e.durationMs !== 'number') return null
      return { kind: 'stage:done', runId, phase: e.phase, durationMs: e.durationMs }
    case 'turn:end': {
      if (typeof e.turn !== 'number') return null
      const cov = e.coverage as { ratio?: unknown } | undefined
      return {
        kind: 'agent:iteration',
        runId,
        turn: e.turn,
        progress: typeof e.progress === 'string' ? e.progress : 'unknown',
        coverageRatio: typeof cov?.ratio === 'number' ? cov.ratio : null,
      }
    }
    default:
      return null // R10：未知 type 忽略（向前兼容）
  }
}

export class EventTail {
  private offsets = new Map<string, number>() // events.jsonl 绝对路径 → 已消费字节
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false

  constructor(
    private readonly opts: EventTailOptions,
    private readonly onEvent: (e: TailEvent) => void,
  ) {}

  start(): void {
    // 起点 = 当前 EOF：live-only，不重放历史（长 run 不洪水）
    for (const f of this.listEventFiles()) this.offsets.set(f, this.sizeOf(f))
    const runsDir = join(this.opts.nxMkDir, 'runs')
    if ((this.opts.useWatch ?? true) && this.tryWatch(runsDir)) return
    this.timer = setInterval(() => this.drain(), this.opts.pollMs ?? 500)
  }

  /** E6：watch 建立失败 → false，调用方落轮询；运行期 watch error 也转轮询 */
  private tryWatch(runsDir: string): boolean {
    try {
      if (!existsSync(runsDir)) return false // runs 目录未建（首次 run 前）→ 直接轮询，后建目录靠轮询发现
      this.watcher = watch(runsDir, { recursive: true }, () => this.drain())
      this.watcher.on('error', () => this.fallbackToPoll())
      return true
    } catch {
      return false
    }
  }

  private fallbackToPoll(): void {
    if (this.timer !== null || this.stopped) return
    this.watcher?.close()
    this.watcher = null
    this.timer = setInterval(() => this.drain(), this.opts.pollMs ?? 500)
  }

  /** 增量消费所有 events.jsonl：offset→EOF；残行回退 offset 等下次 */
  drain(): void {
    if (this.stopped) return
    for (const file of this.listEventFiles()) {
      const size = this.sizeOf(file)
      // start() 时已记录 offsets → live-only（从 start 时的 EOF 起，不重放历史）；
      // start() 之后才出现的文件 → 当作"全新流"，从 0 读（这是 spec E6 想要的：捕获新 run）。
      const known = this.offsets.has(file)
      const from = known ? (this.offsets.get(file) ?? 0) : 0
      if (size <= from) continue
      let buf: Buffer
      try {
        buf = readFileSync(file)
      } catch {
        continue // 文件消失竞态容忍
      }
      const chunk = buf.subarray(from).toString('utf8')
      const lines = chunk.split('\n')
      if (!chunk.endsWith('\n')) {
        // 残行：offset 回退到残行起点，等补全后再消费
        const last = lines[lines.length - 1] ?? ''
        this.offsets.set(file, buf.length - Buffer.byteLength(last, 'utf8'))
        lines.pop()
      } else {
        this.offsets.set(file, buf.length)
      }
      const runId = runIdFromPath(this.opts.nxMkDir, file)
      for (const line of lines) {
        if (line.trim() === '') continue
        let raw: unknown
        try {
          raw = JSON.parse(line)
        } catch {
          continue // E7：损坏行跳过，不炸流
        }
        const evt = mapRawEvent(runId, raw)
        if (evt !== null && (this.opts.runId === undefined || this.opts.runId === evt.runId)) {
          this.onEvent(evt)
        }
      }
    }
  }

  private listEventFiles(): string[] {
    const runsDir = join(this.opts.nxMkDir, 'runs')
    if (!existsSync(runsDir)) return []
    try {
      return readdirSync(runsDir)
        .map((n) => join(runsDir, n, 'events.jsonl'))
        .filter((f) => existsSync(f))
    } catch {
      return []
    }
  }

  private sizeOf(file: string): number {
    try {
      return statSync(file).size
    } catch {
      return 0
    }
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }
}

/** runs/<runId>/events.jsonl → runId（Windows 反斜杠兼容） */
function runIdFromPath(nxMkDir: string, file: string): string {
  const rel = relative(join(nxMkDir, 'runs'), file)
  return rel.split(/[\\/]/)[0] ?? ''
}