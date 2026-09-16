/**
 * 代理路径归一化 —— spec §3.1 / Plan §17
 * 委托 @nx-mk/manifest-schema 的 normalizePath（'a.0.b' → 'a[].b'），避免两处规则漂移。
 */
import { normalizePath } from '@nx-mk/manifest-schema'

/** 代理读取时的段拼接 + 归一化（数字段 → []） */
export function normalizeProxyFieldPath(basePath: string, prop: string): string {
  return normalizePath(`${basePath}.${prop}`)
}
