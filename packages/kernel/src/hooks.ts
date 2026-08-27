import { KernelError } from './errors'
import type { Plugin, PluginContext, HookName } from './plugin'
import type { Phase } from './types'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function hookNameForPhase(phase: Phase, timing: 'before' | 'main' | 'after'): HookName {
  if (timing === 'main') return phase
  if (timing === 'before') return `before${capitalize(phase)}` as HookName
  return `after${capitalize(phase)}` as HookName
}

export async function runHook(
  name: HookName,
  plugin: Plugin,
  ctx: PluginContext,
): Promise<void> {
  const handler = plugin.hooks[name]
  if (!handler) return
  try {
    await handler(ctx)
  } catch (err) {
    throw new KernelError(
      'PLUGIN_HOOK_FAILED',
      `Plugin '${plugin.name}' hook '${name}' failed: ${(err as Error).message}`,
      err,
    )
  }
}

export async function runHooksForPhase(
  phase: Phase,
  timing: 'before' | 'main' | 'after',
  plugins: Plugin[],
  ctx: PluginContext,
): Promise<void> {
  const name = hookNameForPhase(phase, timing)
  for (const plugin of plugins) {
    await runHook(name, plugin, ctx)
  }
}
