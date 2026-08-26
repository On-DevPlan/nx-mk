/**
 * EventBus — typed pub/sub for fire-and-forget events.
 *
 * Primary use: pipeline events forwarded to the dashboard via SSE.
 * Subscribers can filter by event type or receive everything.
 *
 * This is intentionally separate from KernelHooks:
 *   - KernelHooks: sequential lifecycle, error-propagating, plugins only
 *   - EventBus:    parallel observation, error-swallowing, anyone can subscribe
 */

import type { DashboardEvent, EventSubscriber, Unsubscribe } from './types.js'

export interface EventBusOptions {
  /** Maximum listeners per type. Default: 64. Prevents unbounded growth. */
  maxListenersPerType?: number
  /** If true, errors in subscribers are swallowed and logged via console. Default: true. */
  swallowSubscriberErrors?: boolean
}

export class EventBus {
  private readonly listeners = new Map<string, Set<EventSubscriber>>()
  private readonly maxListenersPerType: number
  private readonly swallowSubscriberErrors: boolean
  private readonly wildcardListeners = new Set<EventSubscriber>()

  constructor(options: EventBusOptions = {}) {
    this.maxListenersPerType = options.maxListenersPerType ?? 64
    this.swallowSubscriberErrors = options.swallowSubscriberErrors ?? true
  }

  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on<TPayload = unknown>(
    type: string,
    subscriber: (event: DashboardEvent<TPayload>) => void | Promise<void>,
  ): Unsubscribe {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    if (set.size >= this.maxListenersPerType) {
      throw new Error(
        `EventBus: max listeners (${this.maxListenersPerType}) reached for type '${type}'`,
      )
    }
    set.add(subscriber as EventSubscriber)
    return () => {
      set?.delete(subscriber as EventSubscriber)
    }
  }

  /**
   * Subscribe to ALL events. Useful for SSE sinks.
   */
  onAll(subscriber: EventSubscriber): Unsubscribe {
    this.wildcardListeners.add(subscriber)
    return () => {
      this.wildcardListeners.delete(subscriber)
    }
  }

  /**
   * Emit an event to all subscribers (typed + wildcard).
   * Errors in subscribers do not propagate.
   */
  async emit<TPayload = unknown>(event: DashboardEvent<TPayload>): Promise<void> {
    const typed = this.listeners.get(event.type)
    const tasks: Promise<void>[] = []

    if (typed) {
      for (const fn of typed) {
        tasks.push(this.safeInvoke(fn, event))
      }
    }
    for (const fn of this.wildcardListeners) {
      tasks.push(this.safeInvoke(fn, event))
    }

    await Promise.all(tasks)
  }

  /** Total subscriber count (typed + wildcard). */
  size(): number {
    let n = this.wildcardListeners.size
    for (const set of this.listeners.values()) n += set.size
    return n
  }

  /** Clear all subscribers. Useful for tests and kernel teardown. */
  clear(): void {
    this.listeners.clear()
    this.wildcardListeners.clear()
  }

  private async safeInvoke(fn: EventSubscriber, event: DashboardEvent): Promise<void> {
    try {
      await fn(event)
    } catch (err) {
      if (!this.swallowSubscriberErrors) throw err
      // eslint-disable-next-line no-console
      console.error(`[EventBus] subscriber for '${event.type}' threw:`, err)
    }
  }
}