/**
 * 钩子执行器 —— 按插件声明顺序 fail-fast 执行钩子
 *
 * 钩子名由「阶段 + 时机」推导（如 beforeRun / run / afterRun）；
 * 任一插件钩子抛错即包装为 KernelError(PLUGIN_HOOK_FAILED) 中断后续执行，
 * 由内核统一走 shutdown 收尾。
 */
import { KernelError } from './errors'
import type { Plugin, PluginContext, HookName } from './plugin'
import type { Phase } from './types'

// 首字母大写工具，用于拼接 beforeXxx / afterXxx 钩子名
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// 由「阶段 + 时机」推导钩子名：main → 阶段名本身，before/after → 前后缀拼接
export function hookNameForPhase(phase: Phase, timing: 'before' | 'main' | 'after'): HookName {
  if (timing === 'main') return phase
  if (timing === 'before') return `before${capitalize(phase)}` as HookName
  return `after${capitalize(phase)}` as HookName
}

// 执行单个插件的一个钩子；插件未注册该钩子则静默跳过。
// 抛错时包装为 KernelError(PLUGIN_HOOK_FAILED) 并把原始错误挂到 cause 上。
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

// 对插件列表按声明顺序串行执行同一钩子；前一个抛错则后续不再执行（fail-fast）
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
