/**
 * Schema 遍历器 —— 递归展开 OpenAPI Schema 成扁平的 ApiField[]（spec §4.4）
 *
 * 这是 Manifest 生成器的核心：把树状的 OpenAPI Schema（object/array/allOf/oneOf/anyOf/primitive）
 * 摊平成一条条字段记录，供 parser.ts 组装进 ApiManifest，也是 Phase 2 字段代理的字段来源。
 *
 * 关键设计：递归时穿三条路径字符串，分开维护——
 *   rawPathSoFar  — 原始点号路径（如 'data.tags'）
 *   normPathSoFar — 归一化路径（如 'data.tags[]'，数组加 [] 后缀）
 *   ptrSoFar      — JSON Pointer（无前导 '#'，如 '/properties/tags'）
 * 三者可以不同（array-of-primitive 的 path 和 normalizedPath 就不同）。
 */
import { stableFieldId } from './field-id'
import { normalizePath } from './normalizer'
import type { HttpMethod, FieldIdInput } from './field-id'

// 本地字段结构（与 parser.ts 的 ApiField 形状一致；index.ts 在 T6 统一 re-export）
interface LocalApiField {
  id: string
  endpointId: string
  direction: 'request' | 'response'
  status?: string
  path: string                              // 原始字段路径（如 'data.user.id'）
  normalizedPath: string                    // normalizePath() 之后
  name: string
  type: string                              // OpenAPI 类型名：'string' | 'integer' | 'object' ...
  required?: boolean
  nullable?: boolean
  description?: string
  example?: unknown
  enum?: string[]
  // TODO: 由 parser（T5）在遇到命名 $ref schema 时赋值；遍历器拿到的是已解引用的 schema，无法得知名字
  schemaName?: string
  source: { openapiPointer: string }        // 指向 OpenAPI 文档原文的 JSON Pointer
}

// 遍历上下文：稳定 ID 所需的全部信息 + 当前归一化路径前缀 + Pointer 前缀
export interface WalkContext extends Omit<FieldIdInput, 'normalizedFieldPath'> {
  endpointId: string
  normalizedFieldPath: string              // 当前正在遍历的路径前缀
  pointerPrefix?: string                    // JSON Pointer 前缀，如 '/components/schemas/User'
}

// 遍历器认识的 OpenAPI Schema 对象子集（只取需要处理的字段）
interface SchemaNode {
  type?: string
  nullable?: boolean
  description?: string
  example?: unknown
  enum?: string[]
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  required?: string[]
  allOf?: SchemaNode[]
  oneOf?: SchemaNode[]
  anyOf?: SchemaNode[]
}

// 入口：剥掉 Pointer 前导 '#'（容忍调用方传 '/components/...' 或 '#/components/...'），开始递归
export function walkSchema(schema: SchemaNode, ctx: WalkContext): LocalApiField[] {
  const base = (ctx.pointerPrefix ?? '').replace(/^#/, '')
  return walk(schema, ctx, ctx.normalizedFieldPath, ctx.normalizedFieldPath, base)
}

// 递归核心。三个路径参数见文件头注释。
function walk(schema: SchemaNode, ctx: WalkContext, rawPathSoFar: string, normPathSoFar: string, ptrSoFar: string): LocalApiField[] {
  // allOf：把多个子 schema 合并成一个 object schema（properties 合并 + required 拼接）
  if (Array.isArray(schema?.allOf)) {
    const merged: SchemaNode = { type: 'object', properties: {}, required: [] }
    for (const sub of schema.allOf) {
      const props = sub?.properties ?? {}
      Object.assign(merged.properties!, props)
      if (Array.isArray(sub?.required)) {
        merged.required!.push(...sub.required)
      }
    }
    if (schema.nullable) merged.nullable = true
    return walk(merged, ctx, rawPathSoFar, normPathSoFar, ptrSoFar)
  }

  // oneOf/anyOf：每个 variant 各走一遍，路径加 '(oneOf[<idx>])' / '(anyOf[<idx>])' 后缀
  const variantKey = schema?.oneOf ? 'oneOf' : schema?.anyOf ? 'anyOf' : null
  if (variantKey) {
    const fields: LocalApiField[] = []
    const variants: SchemaNode[] = schema[variantKey] ?? []
    variants.forEach((variant: SchemaNode, idx: number) => {
      const variantRaw = `${rawPathSoFar}(${variantKey}[${idx}])`
      const variantNorm = `${normPathSoFar}(${variantKey}[${idx}])`
      // Pointer：镜像嵌套对象形态。无祖先指针时根植于 /oneOf/<idx>，保证是合法 JSON Pointer
      const variantPtr = ptrSoFar ? `${ptrSoFar}/${variantKey}/${idx}` : `/${variantKey}/${idx}`
      fields.push(...walk(variant, ctx, variantRaw, variantNorm, variantPtr))
    })
    return fields
  }

  // array：递归进 items。原始路径停在数组位置；归一化路径加 [] 后缀（spec §6.4 路径归一化）
  if (schema?.type === 'array') {
    const items = schema.items ?? {}
    const itemsPtr = ptrSoFar ? `${ptrSoFar}/items` : '/items'
    return walk(items, ctx, rawPathSoFar, `${normPathSoFar}[]`, itemsPtr)
  }

  // object：为 object 类型的属性产出对象描述符，再扁平化其子字段
  if (schema?.type === 'object' || (schema?.properties && !schema?.type)) {
    const fields: LocalApiField[] = []
    const properties: Record<string, SchemaNode> = schema.properties ?? {}
    const requiredSet = new Set<string>(schema.required ?? [])
    for (const [propName, propSchema] of Object.entries(properties)) {
      const childRaw = rawPathSoFar === '' ? propName : `${rawPathSoFar}.${propName}`
      const childNorm = normPathSoFar === '' ? propName : `${normPathSoFar}.${propName}`
      const childPtr = ptrSoFar ? `${ptrSoFar}/properties/${propName}` : `/properties/${propName}`
      const childFields = walk(propSchema, ctx, childRaw, childNorm, childPtr)
      const required = requiredSet.has(propName) ? true : undefined

      // 先判定子 schema 的种类，再决定怎么提升字段（这是 T4 三轮审查修复的核心区域）
      const isPlainObject =
        propSchema?.type === 'object' || (Boolean(propSchema?.properties) && !propSchema?.type)
      const isAllOf = Array.isArray(propSchema?.allOf)
      const isArray = propSchema?.type === 'array'
      const items = propSchema?.items
      const itemsIsObject =
        isArray && Boolean(items) && (items!.type === 'object' || (Boolean(items!.properties) && !items!.type))
      const isVariant = Boolean(propSchema?.oneOf) || Boolean(propSchema?.anyOf)

      if (isPlainObject || isAllOf) {
        // object/allOf 类型属性：先产父对象描述符，再拼上扁平化的子字段（子字段自带名字）
        fields.push({
          id: stableFieldId({
            method: ctx.method,
            path: ctx.path,
            direction: ctx.direction,
            status: ctx.status,
            normalizedFieldPath: childNorm,
          }),
          endpointId: ctx.endpointId,
          direction: ctx.direction,
          status: ctx.status,
          path: childRaw,
          normalizedPath: childNorm,
          name: propName,
          type: 'object',
          required,
          nullable: propSchema?.nullable ? true : undefined,
          source: { openapiPointer: childPtr },
        })
        fields.push(...childFields)
      } else if (isArray && itemsIsObject) {
        // array-of-object 元素：childFields 是元素对象的字段（如 data.items.id / data.items.sku），
        // 已自带名字 AND 元素级 required —— 既不要改名为数组属性名，也不要被数组属性的
        // required 覆盖。原样透传；不产数组描述符（数组自身的 required 无处可挂）。
        fields.push(...childFields)
      } else if (isVariant) {
        // oneOf/anyOf variants：PRIMITIVE variant 产出未命名叶子（primitive 分支的 name:''），
        // 代表属性本身 —— 给它属性名 + required。OBJECT/ARRAY variant 已产出带名字的后代
        // （如 'data.foo(oneOf[0]).a'），是走查过的字段，必须原样返回，让它们自己的
        // required 存活、父属性的 required 不泄漏到它们身上。
        fields.push(
          ...childFields.map((f) => {
            if (f.name === '') {
              // 该字段代表属性本身（primitive variant）→ 应用属性名 + required
              return { ...f, name: propName, required }
            }
            // 走查过的后代 —— 原样保留（名字 + required）
            return f
          })
        )
      } else {
        // 真正的单叶子（primitive 或 array-of-primitive）：childFields[0] 是叶子描述符，
        // 提升它的 name/required/source。保留多余字段（array-of-array、items 是 oneOf 等
        // 奇异形态），不静默丢弃。
        fields.push(
          {
            ...childFields[0]!,
            name: propName,
            required,
            source: { openapiPointer: childPtr },
          },
          ...childFields.slice(1)
        )
      }
    }
    return fields
  }

  // primitive：产出一条叶子字段描述符
  const field: LocalApiField = {
    id: stableFieldId({
      method: ctx.method,
      path: ctx.path,
      direction: ctx.direction,
      status: ctx.status,
      normalizedFieldPath: normPathSoFar,
    }),
    endpointId: ctx.endpointId,
    direction: ctx.direction,
    status: ctx.status,
    path: rawPathSoFar,
    normalizedPath: normalizePath(normPathSoFar),
    name: '',                          // 由 object 循环提升名字
    type: schema?.type ?? 'unknown',
    required: undefined,
    nullable: schema?.nullable ? true : undefined,
    description: schema?.description,
    example: schema?.example,
    enum: schema?.enum,
    source: { openapiPointer: ptrSoFar ? ptrSoFar : '' },
  }
  return [field]
}
