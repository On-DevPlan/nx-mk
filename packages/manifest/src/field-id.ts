/**
 * 稳定字段 ID —— 给 Manifest 里的每个字段生成不随运行变化的唯一标识（Plan §16.4）
 *
 * 规则：rawKey = method:path:direction:status:normalizedFieldPath，sha1 后取前 12 位 hex。
 * 同一 OpenAPI 文档每次解析 → 相同 ID（可跨运行比较）；不同字段 → 不同 ID。
 * 该稳定性是"manifest.json 可做增量 diff"的基础。
 */
import { createHash } from 'node:crypto'

// HTTP 方法联合：OpenAPI 支持的请求动词
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

// 生成字段 ID 所需的全部输入
export interface FieldIdInput {
  method: HttpMethod
  path: string                              // OpenAPI 路径模板，如 '/users/{id}'（不是实例路径）
  direction: 'request' | 'response'         // 请求方向 or 响应方向
  status?: string                           // 仅 response 有；request 省略
  normalizedFieldPath: string              // 归一化后的字段路径，如 'data[].user.id'
}

// 把 FieldIdInput 编码成 12 位 hex 的稳定 ID
export function stableFieldId(input: FieldIdInput): string {
  const raw = [
    input.method,
    input.path,
    input.direction,
    input.status ?? '',                     // 省略的 status 用空串占位，避免与显式 '200' 撞车
    input.normalizedFieldPath,
  ].join(':')
  return createHash('sha1').update(raw).digest('hex').slice(0, 12)
}
