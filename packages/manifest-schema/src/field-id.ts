/**
 * 稳定字段 ID —— 给 Manifest 里的每个字段生成不随运行变化的唯一标识（Plan §16.4）
 *
 * 规则：rawKey = method:path:direction:status:normalizedFieldPath，sha1 后取前 12 位 hex。
 * 同一 OpenAPI 文档每次解析 → 相同 ID（可跨运行比较）；不同字段 → 不同 ID。
 * 该稳定性是"manifest.json 可做增量 diff"的基础。
 *
 * 相关类型（HttpMethod / FieldIdInput）见 ./types。
 */
import { createHash } from 'node:crypto'
import type { FieldIdInput } from './types'

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