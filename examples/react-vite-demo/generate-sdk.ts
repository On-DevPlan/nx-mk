/**
 * 把 demo 后端 swagger.json → ApiManifest → 用 @nx-mk/client/codegen 产出 typed SDK
 * 然后写到 app/src/generated-sdk.ts。
 *
 * Phase 1.5 SDK-CG1/2 验收夹具：手工构造 ApiManifest（demo 不接 plugin-swagger 全套链路）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { generateSdk } from '../../packages/client/dist/codegen.js'

const manifest = {
  version: '1',
  source: { type: 'openapi', input: './swagger/openapi.json', hash: 'demo' },
  generatedAt: new Date().toISOString(),
  fields: [],
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
        sku: { type: 'string' },
        quantity: { type: 'number' },
        total: { type: 'number' },
        createdAt: { type: 'string' },
      },
    },
    NewOrder: {
      type: 'object',
      required: ['sku', 'quantity'],
      properties: {
        sku: { type: 'string' },
        quantity: { type: 'number' },
      },
    },
  },
  endpoints: [
    {
      id: 'ep1',
      method: 'GET',
      path: '/users/{id}',
      operationId: 'getUser',
      tags: ['users'],
      request: {
        pathParams: [
          {
            id: 'f',
            endpointId: 'ep1',
            direction: 'request',
            path: 'id',
            normalizedPath: 'id',
            name: 'id',
            type: 'string',
            required: true,
            source: { openapiPointer: '' },
          },
        ],
      },
      responses: [{ status: '200', schema: { kind: 'named', name: 'User' }, fields: [] }],
    },
    {
      id: 'ep2',
      method: 'GET',
      path: '/users',
      tags: ['users'],
      responses: [{ status: '200', schema: { kind: 'array' }, fields: [] }],
    },
    {
      id: 'ep3',
      method: 'POST',
      path: '/orders',
      tags: ['orders'],
      request: { body: { kind: 'named', name: 'NewOrder' } },
      responses: [{ status: '201', schema: { kind: 'named', name: 'Order' }, fields: [] }],
    },
  ],
}

const code = generateSdk(manifest, { baseUrl: '/api' })
writeFileSync(new URL('./app/src/generated-sdk.ts', import.meta.url), code)
console.log(`[codegen] wrote app/src/generated-sdk.ts (${code.length} bytes)`)
