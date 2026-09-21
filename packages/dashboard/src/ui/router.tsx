/**
 * 手写 hash router（spec §3.4）：纯函数匹配逻辑（matchRoute/parseHash/resolvePage）
 * 与 React 薄包装（useHashRoute/navigate）分离——纯函数可测，hook 不含逻辑。
 * 路由表即页面清单；页面路径全在 #/ 之后，server 永远只见 /。
 */
import { useEffect, useState } from 'react'

export type PageId =
  | 'overview' | 'runs' | 'run' | 'requests' | 'request' | 'fields' | 'ignored' | 'manifest' | 'settings' | 'scenarios' | 'not-found'

export const ROUTES: { pattern: string; page: PageId }[] = [
  { pattern: '/', page: 'overview' },
  { pattern: '/runs', page: 'runs' },
  { pattern: '/runs/:runId', page: 'run' },
  { pattern: '/runs/:runId/requests', page: 'requests' },
  { pattern: '/runs/:runId/requests/:requestId', page: 'request' },
  { pattern: '/runs/:runId/fields', page: 'fields' },
  { pattern: '/runs/:runId/ignored', page: 'ignored' },
  { pattern: '/runs/:runId/manifest', page: 'manifest' },
  { pattern: '/settings/plugins', page: 'settings' },
  { pattern: '/scenarios', page: 'scenarios' },
]

/** 段数相等 + 字面段全等 + :param 提取（decodeURIComponent） */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const sp = path.split('/').filter(Boolean)
  if (pp.length !== sp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i]!
    const actual = sp[i]!
    if (seg.startsWith(':')) {
      try {
        params[seg.slice(1)] = decodeURIComponent(actual)
      } catch {
        return null // 畸形百分号转义 → 按未知路径处理（not-found），不在渲染期抛 URIError
      }
    } else if (seg !== actual) return null
  }
  return params
}

/** '#/runs/x?q=1' → '/runs/x'；空 → '/' */
export function parseHash(hash: string): string {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  const path = h.split('?')[0] ?? ''
  return path === '' ? '/' : path
}

export function resolvePage(path: string): { page: PageId; params: Record<string, string> } {
  for (const r of ROUTES) {
    const params = matchRoute(r.pattern, path)
    if (params !== null) return { page: r.page, params }
  }
  return { page: 'not-found', params: {} }
}

export function useHashRoute(): { path: string; page: PageId; params: Record<string, string> } {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const path = parseHash(hash)
  const resolved = resolvePage(path)
  return { path, page: resolved.page, params: resolved.params }
}

export function navigate(to: string): void {
  window.location.hash = to
}
