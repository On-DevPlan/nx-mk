/**
 * configSchema 驱动的 YAML 片段生成器（spec R6/U3：只读 + 复制导出，不写回）。
 * v0 语义（V5）：插件从全局配置读字段，故片段是顶层键名列表；
 * 无 schema → 自由编辑提示注释（R8/E5 降级）。
 */
import type { PluginEntryView } from '../shared/api-types'

interface SchemaLike {
  type?: unknown
  properties?: Record<string, { type?: unknown; description?: unknown; enum?: unknown }>
  required?: unknown
}

/** JSON Schema → YAML 键名占位片段（properties 顺序；required 标注；枚举给合法值） */
export function yamlSnippet(entry: PluginEntryView): string {
  if (entry.configSchema === null) {
    return `# ${entry.name}: no schema exposed — free-form config\n`
  }
  const schema = entry.configSchema as SchemaLike
  const props = schema.properties ?? {}
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((x): x is string => typeof x === 'string')
      : [],
  )
  const lines: string[] = [`# ${entry.name} (v${entry.version}) config snippet`]
  for (const [key, def] of Object.entries(props)) {
    const comment = typeof def.description === 'string' ? ` # ${def.description}` : ''
    const mark = required.has(key) ? '' : '?' // YAML optional-key 约定
    lines.push(`${key}${mark}: ${placeholder(def)}${comment}`)
  }
  if (lines.length === 1) lines.push('# (schema declares no properties)')
  return lines.join('\n') + '\n'
}

function placeholder(def: { type?: unknown; enum?: unknown }): string {
  if (Array.isArray(def.enum) && def.enum.length > 0 && typeof def.enum[0] === 'string') {
    return JSON.stringify(def.enum[0])
  }
  switch (def.type) {
    case 'string':
      return "''"
    case 'number':
    case 'integer':
      return '0'
    case 'boolean':
      return 'false'
    case 'array':
      return '[]'
    case 'object':
      return '{}'
    default:
      return 'null'
  }
}