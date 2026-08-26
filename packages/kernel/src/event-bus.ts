import { EventEmitter } from 'node:events'
import type { Phase } from './types'

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
      type: 'log'
      level: 'debug' | 'info' | 'warn' | 'error'
      message: string
      meta?: Record<string, unknown>
    }

type Handler<T extends KernelEvent> = (event: T) => void | Promise<void>

export interface EventBusOptions {
  persistTo?: NodeJS.WritableStream
}

export class EventBus {
  private readonly emitter = new EventEmitter()
  private readonly persistStream?: NodeJS.WritableStream

  constructor(opts: EventBusOptions = {}) {
    this.persistStream = opts.persistTo
    this.emitter.setMaxListeners(50)
  }

  emit(event: KernelEvent): void {
    if (this.persistStream) {
      this.persistStream.write(JSON.stringify(event) + '\n')
    }
    this.emitter.emit(event.type, event)
  }

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