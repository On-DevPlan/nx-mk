/**
 * @nx-mk-example/orders-server —— 订单/商品后端（验证项目二）
 *
 * 形状族（spec §3.2）：分页 envelope（data.items[] + total/page/pageSize/hasNext）、
 * 三层数组（data.items[].tags[]、data[].items[]）、数组→对象→对象嵌套
 * （data[].shipping.address.*）、双 nullable（line2 / paidAt）。
 *
 * P1：query 参数 ?page=&pageSize= 不进 coverage 分母（manifest 只收响应字段，
 * 见 packages/manifest/src/parser.ts 的 allFields.push 注释）—— 页面仍需传它们
 * 才能拿到分页数据，但不需（也不应）为它们渲染 data-mk-field。
 *
 * P1 + C1 回显设计：POST /orders 的 201 体回显写入派生值（id / status /
 * totalAmount / placedAt），供页面渲染同一路径。注意：**没有 data.createdAt** ——
 * 回显字段集是 CreatedOrderSchema 的四键，页面与场景都以此为准（brief 里
 * 的 data.createdAt 是笔误，本项目不存在该路径）。
 *
 * 真 100% 口径（G1）：不造 4xx/5xx 响应体 —— 每个响应 schema 字段都需被渲染，
 * 错误响应验证由项目三专责（同 medical-records 的取舍）。
 */
import { serve } from '@hono/node-server'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const SupplierSchema = z
  .object({
    id: z.string().openapi({ example: 'sup_01' }),
    name: z.string().openapi({ example: '宁波精密制造' }),
    region: z.string().openapi({ example: '华东' }),
  })
  .openapi('Supplier')

const CurrencyEnum = z.enum(['CNY', 'USD', 'EUR'])

const ProductSchema = z
  .object({
    id: z.string().openapi({ example: 'prd_001' }),
    sku: z.string().openapi({ example: 'SKU-8842' }),
    name: z.string().openapi({ example: '静音机械键盘' }),
    price: z.number().openapi({ example: 399 }),
    currency: CurrencyEnum.openapi({ example: 'CNY' }),
    category: z.string().openapi({ example: '外设' }),
    tags: z.array(z.string()).openapi({ example: ['电脑', '办公'] }),
    supplier: SupplierSchema,
  })
  .openapi('Product')

// 分页 envelope：数组包在 data.items 下，四个标量与数组平级
const ProductPageSchema = z
  .object({
    items: z.array(ProductSchema).openapi({ example: [] }),
    total: z.number().int().openapi({ example: 42 }),
    page: z.number().int().openapi({ example: 1 }),
    pageSize: z.number().int().openapi({ example: 10 }),
    hasNext: z.boolean().openapi({ example: true }),
  })
  .openapi('ProductPage')

const AddressSchema = z
  .object({
    line1: z.string().openapi({ example: '文一西路 969 号' }),
    line2: z.string().nullable().openapi({ example: 'A 座 15F' }),
    city: z.string().openapi({ example: '杭州' }),
    postalCode: z.string().openapi({ example: '310000' }),
    country: z.string().openapi({ example: '中国' }),
  })
  .openapi('ShippingAddress')

const ShippingSchema = z
  .object({
    recipient: z.string().openapi({ example: '王芳' }),
    address: AddressSchema,
  })
  .openapi('Shipping')

const PaymentSchema = z
  .object({
    method: z.enum(['alipay', 'wechat', 'card']).openapi({ example: 'alipay' }),
    paidAt: z.string().nullable().openapi({ example: '2026-09-30T11:20:00Z' }),
  })
  .openapi('Payment')

const OrderItemSchema = z
  .object({
    sku: z.string().openapi({ example: 'SKU-8842' }),
    name: z.string().openapi({ example: '静音机械键盘' }),
    unitPrice: z.number().openapi({ example: 399 }),
    quantity: z.number().int().openapi({ example: 2 }),
    lineTotal: z.number().openapi({ example: 798 }),
  })
  .openapi('OrderItem')

const OrderStatusEnum = z.enum(['pending', 'paid', 'shipped', 'completed', 'cancelled'])

const OrderSchema = z
  .object({
    id: z.string().openapi({ example: 'ord_001' }),
    status: OrderStatusEnum.openapi({ example: 'paid' }),
    placedAt: z.string().openapi({ example: '2026-09-30T10:05:00Z' }),
    totalAmount: z.number().openapi({ example: 1836 }),
    currency: CurrencyEnum.openapi({ example: 'CNY' }),
    items: z.array(OrderItemSchema).openapi({ example: [] }),
    shipping: ShippingSchema,
    payment: PaymentSchema,
  })
  .openapi('Order')

const OrderDetailSchema = z
  .object({
    id: z.string().openapi({ example: 'ord_001' }),
    status: OrderStatusEnum.openapi({ example: 'shipped' }),
    customerName: z.string().openapi({ example: '王芳' }),
    note: z.string().nullable().openapi({ example: '工作日送达' }),
  })
  .openapi('OrderDetail')

const NewOrderSchema = z
  .object({
    sku: z.string().openapi({ example: 'SKU-8842' }),
    quantity: z.number().int().min(1).openapi({ example: 2 }),
  })
  .openapi('NewOrder')

const CreatedOrderSchema = z
  .object({
    id: z.string().openapi({ example: 'ord_new' }),
    status: OrderStatusEnum.openapi({ example: 'pending' }),
    totalAmount: z.number().openapi({ example: 798 }),
    placedAt: z.string().openapi({ example: '2026-10-04T10:00:00Z' }),
  })
  .openapi('CreatedOrder')

const listProductsRoute = createRoute({
  method: 'get',
  path: '/products',
  operationId: 'listProducts',
  tags: ['products'],
  summary: '商品分页列表',
  request: { query: z.object({ page: z.string().optional(), pageSize: z.string().optional() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: ProductPageSchema } } },
  },
})

const listOrdersRoute = createRoute({
  method: 'get',
  path: '/orders',
  operationId: 'listOrders',
  tags: ['orders'],
  summary: '订单列表',
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(OrderSchema) } } },
  },
})

const createOrderRoute = createRoute({
  method: 'post',
  path: '/orders',
  operationId: 'createOrder',
  tags: ['orders'],
  summary: '下单（201 回显）',
  request: { body: { content: { 'application/json': { schema: NewOrderSchema } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: CreatedOrderSchema } } },
  },
})

const getOrderRoute = createRoute({
  method: 'get',
  path: '/orders/{orderId}',
  operationId: 'getOrder',
  tags: ['orders'],
  summary: '订单详情',
  request: { params: z.object({ orderId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: OrderDetailSchema } } },
  },
})

const PRODUCTS = [
  {
    id: 'prd_001', sku: 'SKU-8842', name: '静音机械键盘', price: 399, currency: 'CNY' as const,
    category: '外设', tags: ['电脑', '办公'], supplier: { id: 'sup_01', name: '宁波精密制造', region: '华东' },
  },
  {
    id: 'prd_002', sku: 'SKU-1031', name: '人体工学椅', price: 1899, currency: 'CNY' as const,
    category: '家具', tags: ['办公'], supplier: { id: 'sup_02', name: '佛山家具工业', region: '华南' },
  },
]

type Order = {
  id: string
  status: 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled'
  placedAt: string
  totalAmount: number
  currency: 'CNY' | 'USD' | 'EUR'
  items: { sku: string; name: string; unitPrice: number; quantity: number; lineTotal: number }[]
  shipping: { recipient: string; address: { line1: string; line2: string | null; city: string; postalCode: string; country: string } }
  payment: { method: 'alipay' | 'wechat' | 'card'; paidAt: string | null }
}

const ORDERS: Order[] = [
  {
    id: 'ord_001', status: 'paid', placedAt: '2026-09-30T10:05:00Z', totalAmount: 1836, currency: 'CNY',
    items: [
      { sku: 'SKU-8842', name: '静音机械键盘', unitPrice: 399, quantity: 2, lineTotal: 798 },
      { sku: 'SKU-1031', name: '人体工学椅', unitPrice: 519, quantity: 2, lineTotal: 1038 },
    ],
    shipping: { recipient: '王芳', address: { line1: '文一西路 969 号', line2: 'A 座 15F', city: '杭州', postalCode: '310000', country: '中国' } },
    payment: { method: 'alipay', paidAt: '2026-09-30T11:20:00Z' },
  },
  {
    id: 'ord_002', status: 'pending', placedAt: '2026-10-02T16:40:00Z', totalAmount: 399, currency: 'CNY',
    items: [{ sku: 'SKU-8842', name: '静音机械键盘', unitPrice: 399, quantity: 1, lineTotal: 399 }],
    shipping: { recipient: '李强', address: { line1: '中关村大街 27 号', line2: null, city: '北京', postalCode: '100080', country: '中国' } },
    // nullable 验证点 2：未支付 → paidAt 为 null，页面必须渲染占位符（A1/A2）
    payment: { method: 'wechat', paidAt: null },
  },
]

export const app = new OpenAPIHono()

app.openapi(listProductsRoute, (c) => {
  const { page, pageSize } = c.req.valid('query')
  const p = Number(page ?? 1)
  const size = Number(pageSize ?? 10)
  const start = (p - 1) * size
  const slice = PRODUCTS.slice(start, start + size)
  return c.json(
    { items: slice, total: PRODUCTS.length * 42, page: p, pageSize: size, hasNext: start + size < PRODUCTS.length * 42 },
    200,
  )
})

app.openapi(listOrdersRoute, (c) => c.json(ORDERS, 200))

app.openapi(createOrderRoute, (c) => {
  const body = c.req.valid('json')
  return c.json(
    { id: `ord_${Date.now()}`, status: 'pending', totalAmount: body.quantity * 399, placedAt: new Date().toISOString() },
    201,
  )
})

app.openapi(getOrderRoute, (c) => {
  const { orderId } = c.req.valid('param')
  const found = ORDERS.find((o) => o.id === orderId)
  const fallback = { id: '', status: 'cancelled' as const, customerName: '', note: null }
  // 找到与否都返回同 schema 的值（而非 404 body）—— 避免新增响应 schema 拉高覆盖分母。
  // note 恒为 null：这是本项目第三条 nullable 路径（data.note），页面渲染占位符（A1/A2）。
  return c.json(found ? { id: found.id, status: found.status, customerName: found.shipping.recipient, note: null } : fallback, 200)
})

app.doc('/doc', {
  openapi: '3.0.3',
  info: { title: 'nx-mk commerce orders API', version: '0.1.0', description: '验证项目二：分页 envelope + 深层数组' },
})

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT ?? 8802)
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[orders/server] listening on http://localhost:${info.port}`)
  })
}
