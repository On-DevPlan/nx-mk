/**
 * OpenAPI → Manifest 解析器 —— @nx-mk/manifest 的主入口（spec §4.1）
 *
 * 流程：读文件 → sha1 源哈希 → SwaggerParser 解引用 $ref 并校验 → 遍历 paths/methods →
 * 解析请求参数 + 响应字段（走 schema-walker）→ 组装 ApiManifest。
 * 产物（ApiManifest）是 Phase 2 字段代理的字段来源，也是 .nx-mk/manifest.json 的内容。
 *
 * M4 拆分：本文件只保留 OpenAPI 解析逻辑。
 * 所有数据结构（ApiField / ApiEndpoint / ApiManifest / ...）见 @nx-mk/manifest-schema。
 * schema-walker / normalizer / field-id 工具见 @nx-mk/manifest-schema。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import SwaggerParser from '@apidevtools/swagger-parser'
import { walkSchema } from '@nx-mk/manifest-schema'
import type {
  HttpMethod,
  ApiField,
  ApiEndpoint,
  ApiManifest,
  ApiSchema,
  ParseOptions,
  SchemaRef,
} from '@nx-mk/manifest-schema'

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
  // named ref 只存在于原文：deref 前先按 path+method 预扫描 raw spec（spec §3.2）
  const rawApi: any = JSON.parse(raw)
  const rawRefs = extractRawSchemaRefs(rawApi)
  const api: any = await new SwaggerParser().dereference(rawApi)

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

      const refs = rawRefs.get(`${httpMethod}:${path}`)

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
          schema: refs?.responses[status] ?? (schema ? { kind: 'object' } : undefined),
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
        request:
          pathParams.length || query.length || headers.length || refs?.body
            ? {
                pathParams: pathParams.length ? pathParams : undefined,
                query: query.length ? query : undefined,
                headers: headers.length ? headers : undefined,
                ...(refs?.body ? { body: refs.body } : {}),
              }
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

// =====================================================================
// raw spec 预扫描 —— named ref 只在原文存在（deref 会内联），spec §3.2
// =====================================================================

interface RawEndpointRefs {
  responses: Record<string, SchemaRef | undefined>
  body?: SchemaRef
}

/** 按 `METHOD:path` 提取每个 operation 的响应/requestBody 顶层 schema 引用（只看顶层，不递归） */
function extractRawSchemaRefs(api: any): Map<string, RawEndpointRefs> {
  const map = new Map<string, RawEndpointRefs>()
  for (const [path, pathItem] of Object.entries<any>(api.paths ?? {})) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue
      const responses: Record<string, SchemaRef | undefined> = {}
      for (const [status, response] of Object.entries<any>(operation.responses ?? {})) {
        responses[status] = classifyRawSchema(response?.content?.['application/json']?.schema)
      }
      const body = classifyRawSchema(operation.requestBody?.content?.['application/json']?.schema)
      map.set(`${method.toUpperCase()}:${path}`, { responses, body })
    }
  }
  return map
}

/** 顶层分类：$ref → named；array → array(+items)；原始类型 → primitive；其余 object（异常形态降级不抛错） */
function classifyRawSchema(schema: any): SchemaRef | undefined {
  if (!schema) return undefined
  if (typeof schema.$ref === 'string') return { kind: 'named', name: refName(schema.$ref) }
  if (schema.type === 'array') {
    const items = classifyRawSchema(schema.items)
    return items ? { kind: 'array', items } : { kind: 'array' }
  }
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer' || schema.type === 'boolean') {
    return { kind: 'primitive', type: schema.type }
  }
  return { kind: 'object' }
}

/** '#/components/schemas/User' → 'User'；RFC6901 反逃逸：~1 → /、~0 → ~ */
function refName(ref: string): string {
  const last = ref.split('/').pop() ?? ''
  return last.replace(/~1/g, '/').replace(/~0/g, '~')
}