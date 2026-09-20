/**
 * plugins-manifest.json 落盘（Phase 4.5 spec R7）：initPlugins 完成后一次性写
 * .nx-mk/plugins-manifest.json，供 dashboard 只读消费（GET /api/plugins）。
 * 写失败静默跳过——dashboard 侧按缺失降级（E4），分析产物不缺角。
 *
 * V5' 裁定：v1 起 plugins 为联合类型，条目 config = per-plugin 配置（WP6：不在列表中的插件 → null）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from './plugin.js'
import type { ResolvedConfig } from './types.js'
import { normalizePluginEntries } from './plugin-registry.js'

/** plugins-manifest.json 单条目形状（dashboard store/plugins-reader.ts 同构门控） */
export interface PluginManifestEntry {
  name: string
  version: string
  /** v0 无停用语义，恒 true；形状为 v1 预留 */
  enabled: boolean
  /** per-plugin 配置（V5'）；不在 plugins 列表/不可得 → null */
  config: unknown
  /** standard-schema 适配器挂 jsonSchema 属性则取之；否则 null（spec E5/R8） */
  configSchema: Record<string, unknown> | null
}

export interface PluginsManifestFile {
  generatedAt: string
  plugins: PluginManifestEntry[]
}

/** standard-schema 对象 → JSON Schema：仅当适配器挂了可序列化 jsonSchema 属性（E5：否则 null） */
export function serializeConfigSchema(schema: Plugin['configSchema']): Record<string, unknown> | null {
  if (!schema) return null
  const candidate = (schema as { jsonSchema?: unknown }).jsonSchema
  if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>
  }
  return null
}

export function buildPluginsManifest(plugins: Plugin[], config: ResolvedConfig | undefined): PluginsManifestFile {
  const entries = config ? normalizePluginEntries(config.plugins) : []
  const configByName = new Map(entries.map((e) => [e.name, e.config]))
  return {
    generatedAt: new Date().toISOString(),
    plugins: plugins.map((p) => ({
      name: p.name,
      version: p.version,
      enabled: true,
      config: configByName.get(p.name) ?? null,
      configSchema: serializeConfigSchema(p.configSchema),
    })),
  }
}

/** initPlugins 完成后调用；任何 IO 失败吞掉（dashboard E4 兜底），不影响 run */
export function writePluginsManifest(cwd: string, manifest: PluginsManifestFile): void {
  try {
    const dir = join(cwd, '.nx-mk')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'plugins-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  } catch {
    // 落盘失败不阻断 run —— dashboard 按缺失降级（E4）
  }
}
