/**
 * plugins-manifest.json 只读读取（spec R7/E4）：形状门控 + 逐条 sanitize，
 * 缺失/非法 → stale 降级。语义同构 report-reader.ts（缺失按空处理，不炸路由）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginEntryView, PluginsResponse } from '../../shared/api-types.js'

export type PluginsManifestView = PluginsResponse

export function readPluginsManifest(nxMkDir: string): PluginsManifestView {
  let raw: string
  try {
    raw = readFileSync(join(nxMkDir, 'plugins-manifest.json'), 'utf8')
  } catch {
    return { plugins: [], stale: true }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { plugins: [], stale: true }
  }
  const list = (parsed as { plugins?: unknown } | null)?.plugins
  if (!Array.isArray(list)) return { plugins: [], stale: true }
  const plugins: PluginEntryView[] = []
  for (const item of list) {
    const e = sanitizeEntry(item)
    if (e !== null) plugins.push(e)
  }
  return { plugins, stale: false }
}

function sanitizeEntry(v: unknown): PluginEntryView | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.name !== 'string' || typeof o.version !== 'string') return null
  return {
    name: o.name,
    version: o.version,
    enabled: o.enabled === true,
    config: o.config ?? null,
    configSchema: isPlainObject(o.configSchema) ? (o.configSchema as Record<string, unknown>) : null, // E5/R8
  }
}

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}