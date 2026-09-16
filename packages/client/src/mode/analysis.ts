/**
 * analysis 组装（spec §3.5）：analysis context factory + URL→endpoint 匹配
 * goal：production 分支不依赖本文件任何内容（零开销）。
 */
import type { ApiManifest } from '@nx-mk/manifest-schema'
import type { Collector } from '../collector/index.js'
import { createCollector } from '../collector/index.js'

export interface AnalysisContext { collector: Collector }

export function createAnalysisContext(opts?: { manifest?: ApiManifest }): AnalysisContext {
  // Phase 2：context 目前只承载 collector；manifest 由调用方注入给 fetch client（预留）
  void opts
  return { collector: createCollector() }
}

/**
 * URL path 与 endpoint path 模板的段匹配（复用 §42.5 语义：{param} 捕获段）。
 * 规则：段数相等；字面段全等；{param} 段匹配任意内容；方法需全等（所有 HTTP 方法均参与匹配）。
 */
export function matchEndpoint(manifest: ApiManifest | undefined, scopePath: string, method?: string): string | undefined {
  if (!manifest) return undefined
  // scopePath: URL pathname，如 /users/u_001；按段匹配 /users/{id}
  const segs = scopePath.split('/').filter(Boolean)
  for (const ep of manifest.endpoints) {
    if (method !== undefined && ep.method !== method) continue
    const tpl = ep.path.split('/').filter(Boolean)
    if (tpl.length !== segs.length) continue
    let ok = true
    for (let i = 0; i < tpl.length; i++) {
      const t = tpl[i]!
      if (t.startsWith('{') && t.endsWith('}')) continue
      if (t !== segs[i]) { ok = false; break }
    }
    if (ok) return ep.id
  }
  return undefined
}
