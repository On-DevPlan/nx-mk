/**
 * 事件总线 —— 类型化内核事件的发布/订阅
 *
 * 基于 Node EventEmitter 封装。emit() 时先把事件序列化为一行 JSON
 * 追加写入持久化流（.nx-mk/runs/{runId}/events.jsonl），再分发给订阅者；
 * 插件经 PluginContext.events 订阅感兴趣的事件类型。
 */
import { EventEmitter } from 'node:events'
import type { Coverage, Phase, PluginWorkerState } from './types'

// 内核全部事件的判别联合：按 type 字段区分（阶段流转 / 插件加载 / 错误 / 日志 / M14 goal loop）
export type KernelEvent =
  | { type: 'phase:start'; phase: Phase; timestamp: string }
  | { type: 'phase:end'; phase: Phase; durationMs: number; error?: { message: string } }
  | { type: 'plugin:loaded'; name: string; version: string }
  | {
      type: 'plugin:error'
      name: string
      hook: string
      phase: Phase
      error: { message: string; stack?: string }
    }
  | { type: 'kernel:error'; phase: Phase; error: { message: string } }
  | {
      type: 'plugin:state-change'
      name: string
      from: PluginWorkerState['kind']
      to: PluginWorkerState['kind']
      timestamp: string
      error?: { code: string; message: string }
    }
  | {
      // M14: Goal Loop 事件
      type: 'turn:start'
      turn: number
      timestamp: string
      idleTurns: number
    }
  | {
      // M14: Goal Loop 事件
      type: 'turn:end'
      turn: number
      timestamp: string
      coverage: Coverage
      progress: 'improved' | 'stagnant' | 'regressed'
    }
  | {
      // M14: Goal Loop 终止事件
      type: 'goal:met'
      coverage: Coverage
      turns: number
      durationMs: number
    }
  | {
      // M14: Goal Loop 未达目标
      type: 'goal:unmet'
      reason: 'max-turns' | 'idle' | 'timeout' | 'all-failed'
      coverage: Coverage
      turns: number
    }
  | {
      type: 'log'
      level: 'debug' | 'info' | 'warn' | 'error'
      message: string
      meta?: Record<string, unknown>
    }

// 事件处理器签名：可同步可异步（异步返回的 Promise 不会被 emit 等待）
type Handler<T extends KernelEvent> = (event: T) => void | Promise<void>

// persistTo：事件持久化目标流（通常为 events.jsonl 的写流）
export interface EventBusOptions {
  persistTo?: NodeJS.WritableStream
}

export class EventBus {
  private readonly emitter = new EventEmitter()
  private readonly persistStream?: NodeJS.WritableStream

  constructor(opts: EventBusOptions = {}) {
    this.persistStream = opts.persistTo
    // 放宽默认 10 个监听器的上限（插件较多时避免 MaxListenersExceededWarning）
    this.emitter.setMaxListeners(50)
  }

  // 发布事件：先持久化（JSONL 追加），再同步分发给该类型的所有订阅者
  emit(event: KernelEvent): void {
    if (this.persistStream) {
      this.persistStream.write(JSON.stringify(event) + '\n')
    }
    this.emitter.emit(event.type, event)
  }

  // 订阅某一类型的事件；返回取消订阅函数（Extract 保证处理器收到精确的事件类型）
  on<T extends KernelEvent['type']>(
    type: T,
    handler: Handler<Extract<KernelEvent, { type: T }>>,
  ): () => void {
    const wrapped = handler as (...args: unknown[]) => void
    this.emitter.on(type, wrapped)
    return () => this.emitter.off(type, wrapped)
  }

  off<T extends KernelEvent['type']>(
    type: T,
    handler: Handler<Extract<KernelEvent, { type: T }>>,
  ): void {
    this.emitter.off(type, handler as (...args: unknown[]) => void)
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners()
  }
}