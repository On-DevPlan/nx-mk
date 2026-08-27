/**
 * 插件注册表 —— 按配置动态加载 npm 插件包并做三段校验
 *
 * 单个插件的加载链路：①动态 import() 包 ②取 default 或 createPlugin 工厂
 * ③调用工厂得到插件对象 ④validateShape 校验结构 ⑤validatePackageMatch
 * 与 package.json 的 name/version 对照。任一步失败抛对应 ErrorCode 的 KernelError。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { KernelError } from './errors'
import type { Plugin } from './plugin'

// cwd 决定插件包的解析基准（默认取当前进程工作目录）
export interface LoadPluginsOptions {
  cwd?: string
}

// 合法插件名 = 合法 npm 包名（可含 scope），用于拦截路径穿越等危险输入
const PLUGIN_NAME_RE = /^@?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/

function isValidPluginName(name: string): boolean {
  return PLUGIN_NAME_RE.test(name)
}

/**
 * 按配置顺序加载插件列表，返回可用的 Plugin 数组。
 * 串行处理且 fail-fast：任何一个插件加载/校验失败立即抛 KernelError。
 */
export async function loadPlugins(
  names: string[],
  opts: LoadPluginsOptions = {},
): Promise<Plugin[]> {
  if (names.length === 0) return []
  const cwd = opts.cwd ?? process.cwd()
  // 以用户项目目录为基准构造 require，让 package.json 解析走用户项目的 node_modules
  const require = createRequire(cwd + '/')
  const plugins: Plugin[] = []
  for (const name of names) {
    // 校验段 ①：插件名必须是合法 npm 包名
    if (!isValidPluginName(name)) {
      throw new KernelError(
        'PLUGIN_LOAD_FAILED',
        `Invalid plugin name: '${name}' (must match ${PLUGIN_NAME_RE})`,
      )
    }
    let mod: unknown
    // 加载段 ②：动态 import 插件包本体
    try {
      mod = await import(name)
    } catch (err) {
      throw new KernelError(
        'PLUGIN_LOAD_FAILED',
        `Failed to load plugin '${name}': ${(err as Error).message}`,
        err,
      )
    }
    // 加载段 ③：解析工厂函数——优先 default 导出，createPlugin 具名导出兜底
    const candidate = (mod as { default?: unknown }).default
    const factory =
      typeof candidate === 'function'
        ? candidate
        : typeof (mod as { createPlugin?: unknown }).createPlugin === 'function'
          ? (mod as { createPlugin: () => unknown }).createPlugin
          : null
    if (!factory) {
      throw new KernelError(
        'PLUGIN_SHAPE_INVALID',
        `Plugin '${name}' must export default a function returning Plugin`,
      )
    }
    let plugin: unknown
    // 调用工厂构造插件对象；工厂自身抛错视为结构非法
    try {
      plugin = (factory as () => unknown)()
    } catch (err) {
      throw new KernelError(
        'PLUGIN_SHAPE_INVALID',
        `Plugin '${name}' factory threw: ${(err as Error).message}`,
        err,
      )
    }
    // 校验段 ④ + ⑤：结构校验，以及与 package.json 的 name/version 对照
    validateShape(plugin, name)
    await validatePackageMatch(plugin as Plugin, name, require)
    plugins.push(plugin as Plugin)
  }
  return plugins
}

// 校验插件对象结构：必须是含字符串 name/version 与 hooks 对象的普通对象
function validateShape(plugin: unknown, name: string): void {
  if (!plugin || typeof plugin !== 'object') {
    throw new KernelError(
      'PLUGIN_SHAPE_INVALID',
      `Plugin '${name}' factory must return an object`,
    )
  }
  const p = plugin as Record<string, unknown>
  if (typeof p.name !== 'string' || typeof p.version !== 'string') {
    throw new KernelError(
      'PLUGIN_SHAPE_INVALID',
      `Plugin '${name}' must have string 'name' and 'version'`,
    )
  }
  if (!p.hooks || typeof p.hooks !== 'object') {
    throw new KernelError(
      'PLUGIN_SHAPE_INVALID',
      `Plugin '${name}' must have 'hooks' object`,
    )
  }
}

/**
 * 校验插件工厂返回的 name/version 与包内 package.json 声明一致，
 * 防止插件冒用身份。package.json 无法解析时（如 ESM-only 特殊布局）跳过不视为致命。
 */
async function validatePackageMatch(
  plugin: Plugin,
  name: string,
  req: NodeJS.Require,
): Promise<void> {
  try {
    const pkgJsonPath = req.resolve(`${name}/package.json`)
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      name?: string
      version?: string
    }
    if (pkg.name !== plugin.name) {
      throw new KernelError(
        'PLUGIN_SHAPE_INVALID',
        `Plugin '${name}' name mismatch: factory='${plugin.name}' package.json='${pkg.name}'`,
      )
    }
    if (pkg.version !== plugin.version) {
      throw new KernelError(
        'PLUGIN_SHAPE_INVALID',
        `Plugin '${name}' version mismatch: factory='${plugin.version}' package.json='${pkg.version}'`,
      )
    }
  } catch (err) {
    if (err instanceof KernelError) throw err
    // package.json not resolvable: not fatal in ESM-only setups; skip.
    // 中文：package.json 解析失败不视为致命（仅跳过对照），真正的校验错误照常抛出
  }
}