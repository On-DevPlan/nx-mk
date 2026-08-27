/**
 * OpenAPI → Manifest 解析器 —— @nx-mk/manifest 的主入口（spec §4.1）
 *
 * 流程：读文件 → sha1 源哈希 → SwaggerParser 解引用 $ref 并校验 → 遍历 paths/methods →
 * 解析请求参数 + 响应字段（走 schema-walker）→ 组装 ApiManifest。
 * 产物（ApiManifest）是 Phase 2 字段代理的字段来源，也是 .nx-mk/manifest.json 的内容。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import SwaggerParser from '@apidevtools/swagger-parser'
import { walkSchema } from './schema-walker'

// HTTP 方法联合（field-id 里的同款；这里作为权威类型被 index.ts re-export）
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

// 单条字段记录（Plan §16.3）：一个叶子/对象/数组字段的完整描述
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

export interface ParseOptions {
  cwd?: string                              // Phase 1 预留；调用方通常传绝对路径
}

// JSON Pointer 转义：RFC 6901 规定 ~ → ~0、/ → ~1
function escapePointerSegment(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * 解析 OpenAPI 文档 → ApiManifest
 * @param specPath OpenAPI 源文件路径（JSON，YAML 暂不支持——见 final review 的已知限制）
 * @param options 预留选项（cwd）
 * @throws 文件不存在（readFileSync ENOENT）/ 无效 OpenAPI（swagger-parser 校验失败）
 */
export async function parseOpenApi(
  specPath: string,
  options: ParseOptions = {},
): Promise<ApiManifest> {
  const raw = readFileSync(specPath, 'utf8')
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16)

  // new SwaggerParser().dereference 解引用所有 $ref 并校验 spec。
  // （默认导出是类构造函数——必须用 new 调用）
  const api: any = await new SwaggerParser().dereference(JSON.parse(raw))

  const endpoints: ApiEndpoint[] = []
  const allFields: ApiField[] = []

  // 遍历 paths：每个 path 下可能有多个 method（get/post/put/patch/delete/head）
  for (const [path, pathItem] of Object.entries<any>(api.paths ?? {})) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue

      const httpMethod = method.toUpperCase() as HttpMethod
      // endpointId = sha1(method:path) 前 12 位（与 stableFieldId 同源）
      const endpointId = createHash('sha1').update(`${httpMethod}:${path}`).digest('hex').slice(0, 12)

      // 请求参数：按 param.in 分流到 pathParams / query / headers
      const pathParams: ApiField[] = []
      const query: ApiField[] = []
      const headers: ApiField[] = []
      const params = (operation.parameters ?? []) as any[]
      for (const [index, param] of params.entries()) {
        const baseCtx = {
          method: httpMethod,
          path,
          direction: 'request' as const,
          status: undefined,
          endpointId,
          normalizedFieldPath: param.name,
        }
        const walkerFields = walkSchema(param.schema ?? {}, baseCtx)
        const field: ApiField = {
          ...walkerFields[0]!,
          name: param.name,
          required: param.required,
          source: {
            openapiPointer: `/paths/${escapePointerSegment(path)}/${method}/parameters/${index}`,
          },
        }
        if (param.in === 'path') pathParams.push(field)
        else if (param.in === 'query') query.push(field)
        else if (param.in === 'header') headers.push(field)
      }

      // 响应：每个 status 一个字段集。用 'data' 前缀走 walkSchema，
      // 让嵌套对象得到点号路径（data.id、data.address.city ...）
      const responses: ApiEndpoint['responses'] = []
      for (const [status, response] of Object.entries<any>(operation.responses ?? {})) {
        const content = response?.content?.['application/json']
        const schema = content?.schema ?? null
        const responseFields: ApiField[] = schema
          ? walkSchema(schema, {
              method: httpMethod,
              path,
              direction: 'response',
              status,
              endpointId,
              normalizedFieldPath: 'data',
            })
          : []

        responses.push({
          status,
          schema: schema ? { kind: 'object' } : undefined,
          fields: responseFields,
        })
        allFields.push(...responseFields)   // 展平进 Manifest.fields（仅响应字段）
      }

      endpoints.push({
        id: endpointId,
        method: httpMethod,
        path,
        operationId: operation.operationId,
        summary: operation.summary,
        tags: operation.tags,
        request: pathParams.length || query.length || headers.length
          ? { pathParams: pathParams.length ? pathParams : undefined,
              query: query.length ? query : undefined,
              headers: headers.length ? headers : undefined }
          : undefined,
        responses,
      })
    }
  }

  // schemas 表：dereference 后的 components.schemas（已内联 $ref）
  const schemas: Record<string, ApiSchema> = {}
  if (api.components?.schemas) {
    for (const [name, schema] of Object.entries<any>(api.components.schemas)) {
      schemas[name] = schema as ApiSchema
    }
  }

  return {
    version: '1',
    source: {
      type: 'openapi',
      input: specPath,
      hash,
    },
    generatedAt: new Date().toISOString(),
    endpoints,
    schemas,
    fields: allFields,
  }
}
