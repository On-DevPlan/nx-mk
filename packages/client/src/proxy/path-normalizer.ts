/**
 * 代理路径归一化 —— spec §3.1 / Plan §17
 * 委托 @nx-mk/manifest-schema 的 normalizePath（'a.0.b' → 'a[].b'），避免两处规则漂移。
 * 走 ./normalizer 子路径而非包 barrel：barrel 同时 re-export stableFieldId
 * （node:crypto），浏览器端（vite dev/client bundle）会被 externalize 致启动崩溃
 * （Phase 2 手动验收发现）；normalizer 子路径是纯函数、无 Node 依赖。
 */
import { normalizePath } from '@nx-mk/manifest-schema/normalizer'

/** 代理读取时的段拼接 + 归一化（数字段 → []） */
export function normalizeProxyFieldPath(basePath: string, prop: string): string {
  return normalizePath(`${basePath}.${prop}`)
}
