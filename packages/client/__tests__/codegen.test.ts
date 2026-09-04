/**
 * @nx-mk/client/codegen 单测（Phase 1.5）
 *
 * 验证：
 * - emitType: ApiSchema → TS string (object/array/primitive/enum)
 * - emitNamedTypes: 多个 schema 拍成 export interface 块
 * - emitEndpoint: method name 推导 + params 类型 + 返回类型
 * - generateSdk: 完整文件生成（含 types + api 对象 + fetch 调用）
 */

import { describe, it, expect } from 'vitest'
import type { ApiManifest } from '@nx-mk/manifest-schema'
import {
  emitType,
  emitNamedTypes,
  emitEndpoint,
  deriveMethodName,
  generateSdk,
} from '../src/codegen/index.js'

const SAMPLE_MANIFEST: ApiManifest = {
  version: '1',
  source: { type: 'openapi', input: 'test.json', hash: 'abc' },
  generatedAt: '2026-09-04T00:00:00Z',
  schemas: {
    User: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string', nullable: true },
        tags: { type: 'array', items: { type: 'string' } },
        address: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            zip: { type: 'string' },
          },
        },
      },
    },
    Order: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        total: { type: 'number' },
      },
    },
  },
  fields: [],
  endpoints: [
    {
      id: 'ep1',
      method: 'GET',
      path: '/users/{id}',
      operationId: 'getUser',
      tags: ['users'],
      request: {
        pathParams: [
          { id: 'f1', endpointId: 'ep1', direction: 'request', path: 'id', normalizedPath: 'id', name: 'id', type: 'string', required: true, source: { openapiPointer: '' } },
        ],
      },
      responses: [
        {
          status: '200',
          schema: { kind: 'named', name: 'User' },
          fields: [],
        },
      ],
    },
    {
      id: 'ep2',
      method: 'GET',
      path: '/users',
      tags: ['users'],
      responses: [
        {
          status: '200',
          schema: { kind: 'array' as const, name: undefined as never },
          fields: [],
        },
      ],
    },
    {
      id: 'ep3',
      method: 'POST',
      path: '/orders',
      tags: ['orders'],
      request: {
        body: { kind: 'named', name: 'Order' },
      },
      responses: [
        {
          status: '201',
          schema: { kind: 'named', name: 'Order' },
          fields: [],
        },
      ],
    },
  ],
}

describe('emitType', () => {
  it('emits object literal with required/optional props', () => {
    const t = emitType({
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, name: { type: 'string' } },
    })
    expect(t).toContain('id: string')
    expect(t).toContain('name?: string')
  })

  it('emits array', () => {
    expect(emitType({ type: 'array', items: { type: 'string' } })).toBe('string[]')
  })

  it('emits enum as union of string literals', () => {
    expect(emitType({ type: 'string', enum: ['a', 'b', 'c'] })).toBe('"a" | "b" | "c"')
  })

  it('handles nested object', () => {
    const t = emitType({
      type: 'object',
      properties: {
        addr: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    })
    expect(t).toContain('addr?')
    // nested object 的属性没标 required → optional
    expect(t).toContain('city?:')
  })
})

describe('emitNamedTypes', () => {
  it('emits one export interface per schema', () => {
    const out = emitNamedTypes(SAMPLE_MANIFEST.schemas)
    expect(out).toMatch(/export interface User \{/)
    expect(out).toMatch(/export interface Order \{/)
    expect(out).toContain('id: string')
  })
})

describe('emitEndpoint', () => {
  it('uses operationId as method name', () => {
    const sig = emitEndpoint(SAMPLE_MANIFEST.endpoints[0]!)
    expect(sig.name).toBe('getUser')
    expect(sig.signature).toContain('Promise<User>')
    expect(sig.httpMethod).toBe('GET')
    expect(sig.fetchTemplate).toContain('/users/${')
  })

  it('derives method name when operationId absent', () => {
    const ep = SAMPLE_MANIFEST.endpoints[1]!  // GET /users
    const sig = emitEndpoint(ep)
    expect(sig.name).toBe('listUsers')
  })

  it('handles POST with body', () => {
    const sig = emitEndpoint(SAMPLE_MANIFEST.endpoints[2]!)
    expect(sig.httpMethod).toBe('POST')
    expect(sig.signature).toContain('Promise<Order>')
    expect(sig.signature).toContain('body: Order')
  })
})

describe('deriveMethodName', () => {
  it('GET with path param uses get + segment', () => {
    expect(deriveMethodName(
      { method: 'GET', path: '/users/{id}' } as never,
      'user',
    )).toBe('getUser')
  })

  it('GET without path param uses list + plural', () => {
    expect(deriveMethodName(
      { method: 'GET', path: '/users' } as never,
      'user',
    )).toBe('listUsers')
  })
})

describe('generateSdk (end-to-end)', () => {
  it('produces valid TypeScript file with types + api object', () => {
    const code = generateSdk(SAMPLE_MANIFEST, { baseUrl: '/api' })
    expect(code).toContain('AUTO-GENERATED')
    expect(code).toContain('import { createFetchClient }')
    expect(code).toContain('export interface User')
    expect(code).toContain('export interface Order')
    expect(code).toContain('users: {')
    expect(code).toContain('orders: {')
    expect(code).toContain("userClient.fetch('GET'")
    expect(code).toContain("userClient.fetch('POST'")
    expect(code).toContain('/users/${')
    expect(code).toContain('} as const')
  })

  it('groups endpoints by tag namespace', () => {
    const code = generateSdk(SAMPLE_MANIFEST)
    // api.users 来自 `users:` namespace + `api.` 是外面 const 的名字
    expect(code).toContain('users: {')
    expect(code).toContain('orders: {')
    expect(code.indexOf('users:')).toBeLessThan(code.indexOf('orders:'))
  })

  it('includes the source input + hash in header comment', () => {
    const code = generateSdk(SAMPLE_MANIFEST)
    expect(code).toContain('test.json')
    expect(code).toContain('abc')
  })
})
