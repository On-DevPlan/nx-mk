/**
 * AsyncSeriesHook — minimal in-house implementation of tapable's hook contract.
 *
 * Handlers run sequentially in registration order. If any handler throws,
 * the error propagates and subsequent handlers are skipped.
 *
 * The kernel uses hooks for lifecycle events that plugins can subscribe to.
 * Plugins should always `tap()` inside their `setup()` method.
 */

import type { AsyncSeriesHook } from './types.js'

interface Tap<TArgs extends readonly unknown[]> {
  readonly name: string
  readonly fn: (...args: TArgs) => Promise<void> | void
}

export class AsyncSeriesHookImpl<TArgs extends readonly unknown[]> implements AsyncSeriesHook<TArgs> {
  private readonly taps: Tap<TArgs>[] = []

  get size(): number {
    return this.taps.length
  }

  tap(name: string, fn: (...args: TArgs) => Promise<void> | void): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('AsyncSeriesHook.tap: name must be a non-empty string')
    }
    if (typeof fn !== 'function') {
      throw new Error(`AsyncSeriesHook.tap('${name}'): fn must be a function`)
    }
    // Disallow duplicate names so log lines are unambiguous.
    if (this.taps.some((t) => t.name === name)) {
      throw new Error(`AsyncSeriesHook.tap: handler '${name}' already registered`)
    }
    this.taps.push({ name, fn })
  }

  async call(...args: TArgs): Promise<void> {
    // Iterate over a snapshot so handlers can safely tap/untap during dispatch.
    const snapshot = this.taps.slice()
    for (const tap of snapshot) {
      await tap.fn(...args)
    }
  }
}

/** Factory: produce a fresh hook instance. */
export function createAsyncSeriesHook<
  TArgs extends readonly unknown[],
>(): AsyncSeriesHook<TArgs> {
  return new AsyncSeriesHookImpl<TArgs>()
}