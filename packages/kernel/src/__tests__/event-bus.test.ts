import { describe, it, expect, vi } from 'vitest'
import { EventBus, type KernelEvent } from '../event-bus'

describe('EventBus', () => {
  it('emits and receives a typed event', () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.on('phase:start', handler)
    bus.emit({ type: 'phase:start', phase: 'loadConfig', timestamp: '2026-01-01T00:00:00Z' })
    expect(handler).toHaveBeenCalledWith({
      type: 'phase:start',
      phase: 'loadConfig',
      timestamp: '2026-01-01T00:00:00Z',
    })
  })

  it('returns an unsubscribe function from on()', () => {
    const bus = new EventBus()
    const handler = vi.fn()
    const unsub = bus.on('phase:end', handler)
    unsub()
    bus.emit({ type: 'phase:end', phase: 'run', durationMs: 10 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('supports multiple subscribers on the same event', () => {
    const bus = new EventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    bus.on('plugin:loaded', h1)
    bus.on('plugin:loaded', h2)
    bus.emit({ type: 'plugin:loaded', name: 'p', version: '1.0.0' })
    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('persists every event as NDJSON to the configured stream', () => {
    const writes: string[] = []
    const stream = {
      write: (chunk: string) => {
        writes.push(chunk)
        return true
      },
    } as unknown as NodeJS.WritableStream
    const bus = new EventBus({ persistTo: stream })
    bus.emit({ type: 'phase:start', phase: 'loadConfig', timestamp: 't1' })
    bus.emit({ type: 'phase:end', phase: 'loadConfig', durationMs: 5 })
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[0]!.trim())).toEqual({
      type: 'phase:start',
      phase: 'loadConfig',
      timestamp: 't1',
    })
    expect(JSON.parse(writes[1]!.trim())).toEqual({
      type: 'phase:end',
      phase: 'loadConfig',
      durationMs: 5,
    })
  })

  it('does not call handler for a different event type', () => {
    const bus = new EventBus()
    const handler = vi.fn()
    bus.on('phase:start', handler)
    bus.emit({ type: 'phase:end', phase: 'loadConfig', durationMs: 1 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('handles plugin:error and kernel:error events with full payloads', () => {
    const bus = new EventBus()
    const pe = vi.fn()
    const ke = vi.fn()
    bus.on('plugin:error', pe)
    bus.on('kernel:error', ke)
    bus.emit({
      type: 'plugin:error',
      name: 'p',
      hook: 'beforeRun',
      phase: 'run',
      error: { message: 'boom', stack: 'stack-trace' },
    })
    bus.emit({
      type: 'kernel:error',
      phase: 'run',
      error: { message: 'kaboom' },
    })
    expect(pe).toHaveBeenCalledOnce()
    expect(ke).toHaveBeenCalledOnce()
    expect(pe.mock.calls[0]![0]).toMatchObject({ error: { message: 'boom' } })
  })

  it('passes a typecheck-time exhaustiveness check on the discriminated union', () => {
    // Compile-time: every event variant must be assignable to KernelEvent.
    const events: KernelEvent[] = [
      { type: 'phase:start', phase: 'loadConfig', timestamp: 't' },
      { type: 'phase:end', phase: 'loadConfig', durationMs: 1 },
      { type: 'phase:end', phase: 'run', durationMs: 1, error: { message: 'x' } },
      { type: 'plugin:loaded', name: 'p', version: '1' },
      { type: 'plugin:error', name: 'p', hook: 'run', phase: 'run', error: { message: 'x' } },
      { type: 'kernel:error', phase: 'run', error: { message: 'x' } },
      { type: 'log', level: 'info', message: 'm' },
      { type: 'log', level: 'debug', message: 'm', meta: { a: 1 } },
    ]
    expect(events).toHaveLength(8)
  })
})