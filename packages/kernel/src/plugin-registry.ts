/**
 * Plugin registry — validates, filters, and orders plugins before bootstrap.
 *
 * Plugins are kept in registration order (FIFO). On bootstrap the registry
 * returns plugins that pass the mode filter and have valid metadata.
 *
 * The kernel uses this internally; tests may also instantiate it directly.
 */

import type { KernelPlugin, RuntimeMode } from './types.js'

export interface RegisteredPlugin<TConfig = unknown> {
  readonly plugin: KernelPlugin<TConfig>
  readonly index: number
}

export class PluginRegistry {
  private readonly plugins: KernelPlugin[] = []

  /** Append a plugin. Throws on invalid metadata or duplicate names. */
  register(plugin: KernelPlugin): this {
    validatePlugin(plugin)
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`PluginRegistry: duplicate plugin '${plugin.name}'`)
    }
    this.plugins.push(plugin)
    return this
  }

  /** Append many plugins. Order preserved. */
  registerAll(plugins: readonly KernelPlugin[]): this {
    for (const p of plugins) this.register(p)
    return this
  }

  /** Return plugins eligible for the given mode, in registration order. */
  resolveForMode(mode: RuntimeMode): readonly RegisteredPlugin[] {
    const out: RegisteredPlugin[] = []
    this.plugins.forEach((plugin, index) => {
      if (plugin.modes && !plugin.modes.includes(mode)) return
      out.push({ plugin, index })
    })
    return out
  }

  /** Return plugins in REVERSE order — used for teardown. */
  resolveForTeardown(): readonly RegisteredPlugin[] {
    const all = this.plugins.map((plugin, index) => ({ plugin, index }))
    return all.reverse()
  }

  /** Number of registered plugins (regardless of mode filter). */
  get size(): number {
    return this.plugins.length
  }

  /** Names in registration order — useful for logging. */
  list(): readonly string[] {
    return this.plugins.map((p) => p.name)
  }

  /** Remove all plugins. */
  clear(): void {
    this.plugins.length = 0
  }
}

function validatePlugin(plugin: KernelPlugin): void {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('PluginRegistry: plugin must be an object')
  }
  if (typeof plugin.name !== 'string' || plugin.name.length === 0) {
    throw new Error('PluginRegistry: plugin.name must be a non-empty string')
  }
  if (typeof plugin.version !== 'string' || plugin.version.length === 0) {
    throw new Error(`PluginRegistry: plugin '${plugin.name}'.version must be a non-empty string`)
  }
  if (typeof plugin.setup !== 'function') {
    throw new Error(`PluginRegistry: plugin '${plugin.name}'.setup must be a function`)
  }
  if (plugin.teardown !== undefined && typeof plugin.teardown !== 'function') {
    throw new Error(`PluginRegistry: plugin '${plugin.name}'.teardown must be a function if provided`)
  }
  if (plugin.modes !== undefined) {
    if (!Array.isArray(plugin.modes)) {
      throw new Error(`PluginRegistry: plugin '${plugin.name}'.modes must be an array`)
    }
    const valid: readonly RuntimeMode[] = ['production', 'development', 'analysis', 'test', 'ci']
    for (const m of plugin.modes) {
      if (!valid.includes(m)) {
        throw new Error(
          `PluginRegistry: plugin '${plugin.name}' has unknown mode '${m}' (valid: ${valid.join(', ')})`,
        )
      }
    }
  }
}