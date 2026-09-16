/**
 * migrate codemod 引擎单测（SDK-CG3，spec §3.4）
 *
 * 锁死：命中替换（GET/POST、0/1 参数）、四类 skip、import 插入去重、
 * 多处替换、未命中文件不改动。IO 不进引擎 —— 输入输出都是字符串。
 */
import { describe, it, expect } from 'vitest'
import type { ApiManifest } from '@nx-mk/manifest-schema'
import { migrateCodemod } from '../src/migrate/index.js'

const MANIFEST: ApiManifest = {
  version: '1',
  source: { type: 'openapi', input: 'test.json', hash: 'abc' },
  generatedAt: '2026-09-16T00:00:00Z',
  schemas: {},
  fields: [],
  endpoints: [
    {
      id: 'ep1', method: 'GET', path: '/users/{id}', operationId: 'getUser', tags: ['users'],
      request: {
        pathParams: [{
          id: 'f1', endpointId: 'ep1', direction: 'request', path: 'id', normalizedPath: 'id',
          name: 'id', type: 'string', required: true, source: { openapiPointer: '' },
        }],
      },
      responses: [{ status: '200', schema: { kind: 'named', name: 'User' }, fields: [] }],
    },
    {
      id: 'ep2', method: 'GET', path: '/users', tags: ['users'],
      responses: [{ status: '200', schema: { kind: 'array', items: { kind: 'named', name: 'User' } }, fields: [] }],
    },
    {
      id: 'ep3', method: 'POST', path: '/orders', tags: ['orders'],
      responses: [{ status: '201', schema: { kind: 'named', name: 'Order' }, fields: [] }],
    },
  ],
}

function migrate(content: string, apiPrefix = '/api') {
  return migrateCodemod({ manifest: MANIFEST, files: [{ path: 'src/a.ts', content }], apiPrefix })
}

describe('migrateCodemod 替换', () => {
  it('路径参数 → api.users.getUser({ id: "u_001" })', () => {
    const { files, report } = migrate(`const p = fetch('/api/users/u_001')`)
    expect(files[0]!.changed).toBe(true)
    expect(files[0]!.content).toContain(`api.users.getUser({ id: "u_001" })`)
    expect(report.replaced).toHaveLength(1)
    expect(report.skipped).toHaveLength(0)
  })

  it('无参数 GET → api.users.listUsers()（派生名与 codegen 同源）', () => {
    const { files } = migrate(`const r = fetch('/api/users')`)
    expect(files[0]!.content).toContain('api.users.listUsers()')
  })

  it('第二参仅 method → 采用并转大写', () => {
    const { files } = migrate(`fetch('/api/orders', { method: 'post' })`)
    expect(files[0]!.content).toContain('api.orders.createOrders()')
  })

  it('同文件多处替换', () => {
    const { files, report } = migrate(`fetch('/api/users')\nfetch('/api/users/u_001')`)
    expect(report.replaced).toHaveLength(2)
    expect(files[0]!.content).toContain('api.users.listUsers()')
    expect(files[0]!.content).toContain('api.users.getUser({ id: "u_001" })')
  })
})

describe('migrateCodemod 跳过（reason 可读）', () => {
  it('动态模板字符串 → dynamic url', () => {
    const { report } = migrate('fetch(`/api/users/${id}`)')
    expect(report.skipped[0]!.reason).toBe('dynamic url')
  })

  it('带 query → query in url', () => {
    const { report } = migrate(`fetch('/api/users?page=1')`)
    expect(report.skipped[0]!.reason).toBe('query in url')
  })

  it('init 含 body/headers → request init not supported', () => {
    const { report } = migrate(`fetch('/api/orders', { method: 'POST', body: JSON.stringify(x) })`)
    expect(report.skipped[0]!.reason).toBe('request init not supported')
  })

  it('前缀外 → outside api prefix', () => {
    const { report } = migrate(`fetch('https://cdn.example.com/api/asset')`)
    // 注意：该 URL 的 path 是 /api/asset —— 引擎按「以 /api/ 开头」判定字面量整体，
    // https:// 开头不命中前缀 → outside api prefix
    expect(report.skipped[0]!.reason).toBe('outside api prefix')
  })

  it('无 endpoint 匹配 → no endpoint match', () => {
    const { report } = migrate(`fetch('/api/nope')`)
    expect(report.skipped[0]!.reason).toBe('no endpoint match')
  })

  it('段数不符不误替换：/api/users/a/b 无匹配', () => {
    const { report } = migrate(`fetch('/api/users/a/b')`)
    expect(report.skipped[0]!.reason).toBe('no endpoint match')
  })
})

describe('migrateCodemod import 处理', () => {
  it('缺 import 时插入，specifier 可覆盖', () => {
    const { files } = migrate(`const p = fetch('/api/users/u_001')`)
    expect(files[0]!.content).toContain(`import { api } from './generated-sdk'`)
  })

  it('已有同 specifier import 不重复插入', () => {
    const { files } = migrate(`import { api } from './generated-sdk'\nexport const p = fetch('/api/users/u_001')`)
    const count = files[0]!.content.split(`import { api } from './generated-sdk'`).length - 1
    expect(count).toBe(1)
  })

  it('未命中文件 changed=false 且内容原样', () => {
    const { files } = migrate(`export const x = 1`)
    expect(files[0]).toEqual({ path: 'src/a.ts', content: `export const x = 1`, changed: false })
  })
})
