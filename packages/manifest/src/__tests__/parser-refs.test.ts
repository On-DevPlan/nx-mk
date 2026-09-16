/**
 * parseOpenApi named-ref 预扫描单测（Phase 1.5 闭环，spec §3.2）
 *
 * dereference 会内联所有 $ref；本组用例锁死「raw 预扫描保留顶层 named ref」的行为：
 * 响应 $ref → named；array + items.$ref → array+items；requestBody $ref → named；
 * inline 对象维持 object；RFC6901 转义名正确还原。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOpenApi } from '../parser.js'

let workDir: string

const userSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' }, name: { type: 'string' } },
}

function writeSpec(paths: Record<string, unknown>, schemas: Record<string, unknown>): string {
  const spec = {
    openapi: '3.0.3',
    info: { title: 't', version: '0' },
    paths,
    components: { schemas },
  }
  const p = join(workDir, 'spec.json')
  writeFileSync(p, JSON.stringify(spec))
  return p
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-refs-test-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('parseOpenApi named refs', () => {
  it('响应 $ref → { kind: named }', async () => {
    const spec = writeSpec(
      {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
          },
        },
      },
      { User: userSchema },
    )
    const manifest = await parseOpenApi(spec)
    const ep = manifest.endpoints.find((e) => e.path === '/users/{id}')!
    expect(ep.responses[0]!.schema).toEqual({ kind: 'named', name: 'User' })
  })

  it('array + items.$ref → { kind: array, items: { kind: named } }', async () => {
    const spec = writeSpec(
      {
        '/users': {
          get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } } },
        },
      },
      { User: userSchema },
    )
    const manifest = await parseOpenApi(spec)
    expect(manifest.endpoints[0]!.responses[0]!.schema).toEqual({
      kind: 'array',
      items: { kind: 'named', name: 'User' },
    })
  })

  it('requestBody $ref → request.body { kind: named }', async () => {
    const spec = writeSpec(
      {
        '/orders': {
          post: {
            responses: { 201: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } },
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } } } },
          },
        },
      },
      { Order: userSchema, NewOrder: userSchema },
    )
    const manifest = await parseOpenApi(spec)
    expect(manifest.endpoints[0]!.request?.body).toEqual({ kind: 'named', name: 'NewOrder' })
  })

  it('inline 对象响应维持 { kind: object }（向后兼容）', async () => {
    const spec = writeSpec(
      {
        '/err': {
          get: { responses: { 404: { description: 'e', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } } } },
        },
      },
      {},
    )
    const manifest = await parseOpenApi(spec)
    expect(manifest.endpoints[0]!.responses[0]!.schema).toEqual({ kind: 'object' })
  })

  it('RFC6901 转义名还原：~1 → /', async () => {
    const spec = writeSpec(
      {
        '/x': {
          get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Weird~1Name' } } } } } },
        },
      },
      { 'Weird/Name': userSchema },
    )
    const manifest = await parseOpenApi(spec)
    expect(manifest.endpoints[0]!.responses[0]!.schema).toEqual({ kind: 'named', name: 'Weird/Name' })
  })

  it('非 #/components/schemas/ 指针降级为 { kind: object }（spec §4）', async () => {
    // $ref 指向 components.responses（dereference 能解析、但不在 schemas 表）→ 不得产出孤儿 named ref
    const spec = {
      openapi: '3.0.3',
      info: { title: 't', version: '0' },
      paths: {
        '/x': {
          get: {
            responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/responses/X' } } } } },
          },
        },
      },
      components: {
        schemas: {},
        responses: { X: { description: 'shared response' } },
      },
    }
    const p = join(workDir, 'spec-nonschema-ref.json')
    writeFileSync(p, JSON.stringify(spec))
    const manifest = await parseOpenApi(p)
    expect(manifest.endpoints[0]!.responses[0]!.schema).toEqual({ kind: 'object' })
  })
})
