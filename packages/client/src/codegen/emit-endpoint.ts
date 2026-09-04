/**
 * Endpoint → method signature 字符串
 *
 * 把 ApiEndpoint 编译为单个方法的调用形态：
 *   - 方法名：operationId 优先；fallback = method.toLowerCase() + camelCased last path segment
 *   - params：从 pathParams + query + body 推导
 *   - 返回：从 responses[0].schema.name（named 引用）
 *
 * 输出示例：
 *   getUser: (params: { id: string }) => Promise<User>
 *
 * 当前简化：
 * - 不支持 header 参数
 * - request body 仅支持单一对象 schema（named ref）
 * - response 仅取第一个 2xx
 */

import type { ApiEndpoint, ApiField, HttpMethod } from '@nx-mk/manifest-schema'

export interface EmitContext {
  namespace: string                       // e.g. "api.users"
  types: Record<string, string>           // schema name → TS type
}

export function deriveMethodName(
  endpoint: ApiEndpoint,
  fallbackSegment: string,
): string {
  if (endpoint.operationId) return endpoint.operationId
  // fallback: getUser / listUsers / createOrder / deleteOrder...
  const verb = endpoint.method.toLowerCase()
  if (verb === 'get' && endpoint.path.includes('{')) {
    // GET /users/{id} → "getUser"
    return `get${capitalize(fallbackSegment)}`
  }
  if (verb === 'get') return `list${capitalize(pluralize(fallbackSegment))}`
  if (verb === 'post') return `create${capitalize(fallbackSegment)}`
  if (verb === 'put') return `replace${capitalize(fallbackSegment)}`
  if (verb === 'patch') return `update${capitalize(fallbackSegment)}`
  if (verb === 'delete') return `delete${capitalize(fallbackSegment)}`
  return `${verb}${capitalize(fallbackSegment)}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function pluralize(s: string): string {
  if (s.endsWith('s')) return s
  if (s.endsWith('y')) return `${s.slice(0, -1)}ies`
  return `${s}s`
}

export function deriveNamespace(endpoint: ApiEndpoint): string {
  const tag = endpoint.tags?.[0]
  if (tag) return tag
  // fallback: path first segment
  const seg = endpoint.path.replace(/^\//, '').split('/')[0] ?? 'root'
  return seg
}

export function pathToFetchPath(templatePath: string, params: ApiField[]): string {
  // /users/{id} → `/users/${encodeURIComponent(String(params.id))}`
  return templatePath.replace(/\{([^}]+)\}/g, (_, name) => `\${encodeURIComponent(String(params['${name}']))}`)
}

export interface MethodSignature {
  name: string
  signature: string
  httpMethod: HttpMethod
  rawPath: string
  fetchTemplate: string                  // 含 `${encodeURIComponent(...)}`
}

export function emitEndpoint(endpoint: ApiEndpoint): MethodSignature {
  const lastSeg = endpoint.path.split('/').filter((s) => s && !s.startsWith('{')).pop() ?? 'root'
  const name = deriveMethodName(endpoint, lastSeg)
  const pathParams = endpoint.request?.pathParams ?? []
  const queryParams = endpoint.request?.query ?? []
  const bodySchema = endpoint.request?.body
  const respSchema = endpoint.responses.find((r) => r.status.startsWith('2'))?.schema
  const respType = respSchema?.kind === 'named' ? respSchema.name : 'unknown'

  // params 类型：path + query + body 合并
  // 简化 params 类型：path 单字段时直接 { id: unknown } 单行
  const buildParamsType = (
    pp: ApiField[],
    qp: ApiField[],
    bodyName?: string,
  ): string => {
    const parts: string[] = []
    for (const p of pp) {
      parts.push(`${p.name}${p.required === false ? '?' : ''}: unknown`)
    }
    for (const q of qp) {
      parts.push(`${q.name}${q.required === false ? '?' : ''}?: unknown`)
    }
    if (bodyName) parts.push(`body: ${bodyName}`)
    if (parts.length === 0) return '{}'
    return `{ ${parts.join('; ')} }`
  }

  const fetchPath = pathToFetchPath(endpoint.path, pathParams)
  const paramsType = buildParamsType(
    pathParams,
    queryParams,
    bodySchema?.kind === 'named' ? bodySchema.name : undefined,
  )

  const signature = `${name}: (params: ${paramsType}): Promise<${respType}> => {`

  return {
    name,
    signature,
    httpMethod: endpoint.method,
    rawPath: endpoint.path,
    fetchTemplate: fetchPath,
  }
}
