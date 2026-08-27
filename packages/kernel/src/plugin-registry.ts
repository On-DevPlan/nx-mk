import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { KernelError } from './errors'
import type { Plugin } from './plugin'

export interface LoadPluginsOptions {
  cwd?: string
}

const PLUGIN_NAME_RE = /^@?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/

function isValidPluginName(name: string): boolean {
  return PLUGIN_NAME_RE.test(name)
}

export async function loadPlugins(
  names: string[],
  opts: LoadPluginsOptions = {},
): Promise<Plugin[]> {
  if (names.length === 0) return []
  const cwd = opts.cwd ?? process.cwd()
  const require = createRequire(cwd + '/')
  const plugins: Plugin[] = []
  for (const name of names) {
    if (!isValidPluginName(name)) {
      throw new KernelError(
        'PLUGIN_LOAD_FAILED',
        `Invalid plugin name: '${name}' (must match ${PLUGIN_NAME_RE})`,
      )
    }
    let mod: unknown
    try {
      mod = await import(name)
    } catch (err) {
      throw new KernelError(
        'PLUGIN_LOAD_FAILED',
        `Failed to load plugin '${name}': ${(err as Error).message}`,
        err,
      )
    }
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
    try {
      plugin = (factory as () => unknown)()
    } catch (err) {
      throw new KernelError(
        'PLUGIN_SHAPE_INVALID',
        `Plugin '${name}' factory threw: ${(err as Error).message}`,
        err,
      )
    }
    validateShape(plugin, name)
    await validatePackageMatch(plugin as Plugin, name, require)
    plugins.push(plugin as Plugin)
  }
  return plugins
}

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
  }
}