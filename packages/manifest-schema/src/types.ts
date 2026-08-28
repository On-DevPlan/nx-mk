/**
 * @nx-mk/manifest 的共享类型 —— 整个包唯一的类型来源（spec §16 / §17）
 *
 * 按域分组、用注释分隔。所有从 @nx-mk/manifest 暴露给外部的类型都从这里 re-export（见 ./index.ts）。
 *
 * 不放：
 *   - 任何函数 / 运行时代码（类型文件保持纯类型）
 *   - 任何仅限单个文件私有的内部状态
 */

// =====================================================================
// HTTP primitive —— OpenAPI 支持的请求动词
// =====================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

// =====================================================================
// Field ID —— 给 Manifest 里的每个字段生成不随运行变化的唯一标识（Plan §16.4）
// 规则：rawKey = method:path:direction:status:normalizedFieldPath，sha1 后取前 12 位 hex。
// 同一 OpenAPI 文档每次解析 → 相同 ID（可跨运行比较）；不同字段 → 不同 ID。
// 该稳定性是"manifest.json 可做增量 diff"的基础。
// =====================================================================

export interface FieldIdInput {
  method: HttpMethod
  path: string                              // OpenAPI 路径模板，如 '/users/{id}'（不是实例路径）
  direction: 'request' | 'response'         // 请求方向 or 响应方向
  status?: string                           // 仅 response 有；request 省略
  normalizedFieldPath: string              // 归一化后的字段路径，如 'data[].user.id'
}

// =====================================================================
// Manifest data model —— 解析产物（Plan §16.1 / §16.2 / §16.3）
// 一次 OpenAPI 解析的完整输出，写入 .nx-mk/manifest.json。
// =====================================================================

// 单条字段记录：一个叶子/对象/数组字段的完整描述（Plan §16.3）
export interface ApiField {
  id: string                                // stableFieldId 生成的稳定 ID
  endpointId: string                        // 所属 endpoint 的 ID
  direction: 'request' | 'response'
  status?: string                           // 仅 response 有
  path: string                              // 原始字段路径（如 'data.id'）
  normalizedPath: string                    // 归一化路径（数组下标 → []）
  name: string
  type: string
  required?: boolean
  nullable?: boolean
  description?: string
  example?: unknown
  enum?: string[]
  schemaName?: string                       // 引用的 components.schemas 名称（若有）
  source: { openapiPointer: string }        // 指向 OpenAPI 文档原文
}

// 单个 API 端点（Plan §16.2）
export interface ApiEndpoint {
  id: string
  method: HttpMethod
  path: string                              // 路径模板，如 '/users/{id}'
  operationId?: string
  summary?: string
  tags?: string[]
  request?: {
    pathParams?: ApiField[]
    query?: ApiField[]
    headers?: ApiField[]
    body?: SchemaRef                         // Phase 1 未解析 requestBody，保持 undefined
  }
  responses: Array<{
    status: string
    schema?: SchemaRef
    fields: ApiField[]
  }>
}

// 响应/请求 body 的 schema 引用（Phase 1 粗粒度：dereference 后只能标 'object'；kind 细分留给 Phase 2）
export type SchemaRef =
  | { kind: 'named'; name: string }
  | { kind: 'inline' }
  | { kind: 'array' }
  | { kind: 'object' }
  | { kind: 'primitive'; type: string }

// 整个 Manifest（Plan §16.1）：一次 OpenAPI 解析的全部产物
export interface ApiManifest {
  version: string                           // 固定 '1'
  source: {
    type: 'openapi'
    input: string                            // 源文件路径
    hash: string                             // 源文件 sha1 前 16 hex（跟踪上游变化）
  }
  generatedAt: string                       // ISO 8601 生成时间（每次运行都变）
  endpoints: ApiEndpoint[]
  schemas: Record<string, ApiSchema>        // components.schemas（解引用后的内联版本）
  fields: ApiField[]                        // 全部 endpoint 的响应字段展平
}

// components.schemas 里单个 schema 的扁平描述
export interface ApiSchema {
  type: string
  properties?: Record<string, ApiSchema>
  items?: ApiSchema
  required?: string[]
  nullable?: boolean
}

// 解析选项（Plan §16 预留）
export interface ParseOptions {
  cwd?: string                              // Phase 1 预留；调用方通常传绝对路径
}

// =====================================================================
// Schema walker —— 递归展开 OpenAPI Schema 成扁平的 ApiField[]（spec §4.4）
// 仅供 ./schema-walker 使用。供调用方观察 traversal 上下文。
// =====================================================================

// 遍历上下文：稳定 ID 所需的全部信息 + 当前归一化路径前缀 + Pointer 前缀
export interface WalkContext extends Omit<FieldIdInput, 'normalizedFieldPath'> {
  endpointId: string
  normalizedFieldPath: string              // 当前正在遍历的路径前缀
  pointerPrefix?: string                    // JSON Pointer 前缀，如 '/components/schemas/User'
}

// 遍历器认识的 OpenAPI Schema 对象子集（只取需要处理的字段）。
// 标为内部类型；外部消费者无需直接使用，保留在此处仅为统一管理。
export interface SchemaNode {
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