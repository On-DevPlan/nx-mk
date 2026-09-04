/**
 * ApiSchema → TypeScript 类型字符串
 *
 * 把 manifest 的 components.schemas (扁平 ApiSchema 树) 编译为
 * 静态可读的 TS 类型。生成的类型被 codegen 包成 named export，
 * 业务代码 `import type { User } from './generated-sdk'`。
 *
 * 当前简化策略：
 * - object → `{ prop1: type1; prop2?: type2; ... }`
 * - array → `type[]`
 * - primitive → `string | number | boolean | null`
 * - 嵌套对象 / 数组递归
 *
 * Phase 2 可替换为更精细的策略（allOf / oneOf / 引用去重等）。
 */
import type { ApiSchema } from '@nx-mk/manifest-schema'

export function emitType(schema: ApiSchema | undefined, schemaName?: string): string {
  if (!schema) return 'unknown'
  const t = schema.type
  switch (t) {
    case 'object': {
      if (!schema.properties) return 'Record<string, unknown>'
      const required = new Set(schema.required ?? [])
      const indent = '  '
      const lines = Object.entries(schema.properties).map(([key, propSchema]) => {
        const opt = required.has(key) ? '' : '?'
        // 递归时多缩进 1 个 2-space 层级
        const propType = emitType(propSchema, schemaName ? `${schemaName}_${key}` : undefined)
        // 如果 propType 是多行（嵌套 object），每行加缩进
        const formatted = propType.includes('\n')
          ? propType.split('\n').map((line, i) => (i === 0 ? line : indent + indent + line)).join('\n')
          : propType
        return `${indent}${key}${opt}: ${formatted}`
      })
      return `{\n${lines.join('\n')}\n}`
    }
    case 'array':
      return `${emitType(schema.items)}[]`
    case 'integer':
    case 'number':
      return 'number'
    case 'string':
      return schema.enum ? schema.enum.map((v) => JSON.stringify(v)).join(' | ') : 'string'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    default:
      return 'unknown'
  }
}

/**
 * 把 schemas 字典拍平成 `export interface` 集合
 */
export function emitNamedTypes(
  schemas: Record<string, ApiSchema>,
): string {
  const lines: string[] = []
  for (const [name, schema] of Object.entries(schemas)) {
    lines.push(`export interface ${name} ${emitType(schema, name)}\n`)
  }
  return lines.join('\n')
}
