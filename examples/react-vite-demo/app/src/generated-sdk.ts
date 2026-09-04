/**
 * Placeholder SDK —— 模拟 Phase 1.5 codegen 产物
 *
 * 真实路径：nx-mk Phase 1.5 codegen 会基于 swagger/openapi.json 生成
 * `@nx-mk/client` typed endpoints，业务代码 `import { api } from '@nx-mk/client'`。
 *
 * 这里手写一个最小版本，便于：
 *   - demo 独立可跑（不需要先跑 codegen）
 *   - codegen 落地后直接替换文件
 *
 * 替换路径：当 Phase 1.5 codegen 落地，把本文件删掉，业务代码 import 改为
 * `import { api } from '@nx-mk/client'`。
 */

const BASE: string =
  typeof __VITE_DEMO_API_BASE__ !== 'undefined'
    ? __VITE_DEMO_API_BASE__
    : 'http://localhost:8787'

export const api = {
  users: {
    getUser: async (id: string): Promise<unknown> => {
      const res = await fetch(`${BASE}/users/${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    list: async (): Promise<unknown[]> => {
      const res = await fetch(`${BASE}/users`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
  },
  orders: {
    create: async (body: { sku: string; quantity: number }): Promise<unknown> => {
      const res = await fetch(`${BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
  },
}
