/**
 * @nx-mk-example/server —— Hono + zod-openapi demo backend (K-X1)
 *
 * 设计目标（对齐 docx/plan/nx-mk-plan.md §8 + §42.5）：
 * - 后端用 Hono（TypeScript-native、<50KB、zod-openapi 自动导 OpenAPI）
 * - 路由表 + schemas 集中定义 → generateOpenAPIDocument() 一次性产出 swagger.json
 * - swagger.json 由 plugin-swagger 解析 → manifest.json → SDK Facade → demo 前端 import
 * - 默认 port 8787，方便 demo app vite dev 跨端口访问
 *
 * 三个 endpoint 覆盖 Phase 1 fixture：
 *   GET  /users/{id}     → 单个 User（id/name/email/tags[]/address{city,zip}）
 *   GET  /users          → User[]
 *   POST /orders         → 新订单（用于演示 request body）
 */
import { serve } from '@hono/node-server'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

// ─── Schemas（manifest 会递归 flatten 出 ApiField） ──────────────────────────
const AddressSchema = z.object({
  city: z.string().openapi({ example: 'Hangzhou' }),
  zip: z.string().openapi({ example: '310000' }),
}).openapi('Address')

const UserSchema = z.object({
  id: z.string().openapi({ example: 'u_001' }),
  name: z.string().openapi({ example: 'Alice' }),
  email: z.string().nullable().openapi({ example: 'alice@example.com' }),
  tags: z.array(z.string()).openapi({ example: ['admin', 'beta'] }),
  address: AddressSchema,
  internalRiskScore: z.number().optional().openapi({
    description: '内部风控字段，应被 Coverage Policy ignored',
    example: 0.12,
  }),
}).openapi('User')

const NewOrderSchema = z.object({
  sku: z.string().openapi({ example: 'sku-001' }),
  quantity: z.number().int().min(1).openapi({ example: 2 }),
}).openapi('NewOrder')

const OrderSchema = z.object({
  id: z.string(),
  sku: z.string(),
  quantity: z.number(),
  total: z.number(),
  createdAt: z.string(),
}).openapi('Order')

// ─── Routes ─────────────────────────────────────────────────────────────────
const getUserRoute = createRoute({
  method: 'get',
  path: '/users/{id}',
  tags: ['users'],
  summary: 'Get user by ID',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: UserSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

const listUsersRoute = createRoute({
  method: 'get',
  path: '/users',
  tags: ['users'],
  summary: 'List all users',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: z.array(UserSchema) } },
    },
  },
})

const createOrderRoute = createRoute({
  method: 'post',
  path: '/orders',
  tags: ['orders'],
  summary: 'Create order',
  request: {
    body: { content: { 'application/json': { schema: NewOrderSchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: OrderSchema } },
    },
  },
})

// ─── In-memory fixtures ─────────────────────────────────────────────────────
const USERS = [
  {
    id: 'u_001',
    name: 'Alice',
    email: 'alice@example.com',
    tags: ['admin', 'beta'],
    address: { city: 'Hangzhou', zip: '310000' },
    internalRiskScore: 0.12,
  },
  {
    id: 'u_002',
    name: 'Bob',
    email: 'bob@example.com',
    tags: ['user'],
    address: { city: 'Shanghai', zip: '200000' },
    internalRiskScore: 0.05,
  },
]

// ─── App ────────────────────────────────────────────────────────────────────
export const app = new OpenAPIHono()

app.openapi(getUserRoute, (c) => {
  const { id } = c.req.valid('param')
  const user = USERS.find((u) => u.id === id)
  if (!user) return c.json({ error: `user ${id} not found` }, 404)
  return c.json(user, 200)
})

app.openapi(listUsersRoute, (c) => {
  return c.json(USERS, 200)
})

app.openapi(createOrderRoute, async (c) => {
  const body = c.req.valid('json')
  const order = {
    id: `o_${Date.now()}`,
    sku: body.sku,
    quantity: body.quantity,
    total: body.quantity * 99,
    createdAt: new Date().toISOString(),
  }
  return c.json(order, 201)
})

// OpenAPI 文档路径：mk plugin-swagger 通过 http://localhost:8787/doc 拉取
app.doc('/doc', {
  openapi: '3.0.3',
  info: {
    title: 'nx-mk demo API',
    version: '0.1.0',
    description: 'Phase 1.5 SDK Facade demo backend',
  },
})

// 入口（tsx watch 启动）
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[demo/server] listening on http://localhost:${info.port}`)
    console.log(`[demo/server] OpenAPI doc: http://localhost:${info.port}/doc`)
  })
}
