/**
 * @nx-mk-example/incidents-server —— DevOps 服务/事件后端（验证项目三）
 *
 * 形状族（spec §3.3）：同 path 多状态码（200 + 503 两组响应 schema）、
 * 非 2xx 响应体字段、数组 + 双对象嵌套 + nullable。
 *
 * 关键：/services/{name}/health 的 503 体刻意包在 data 下（data.code / data.message /
 * data.retryAfterSeconds / data.contact），使 manifest 派生路径与 200 分支同前缀。
 * field-id 的 rawKey 含 status 段，两组分属不同 fieldId，可各自覆盖。
 */
import { serve } from '@hono/node-server'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const ServiceStatusEnum = z.enum(['healthy', 'degraded', 'down'])
const SeverityEnum = z.enum(['sev1', 'sev2', 'sev3'])
const IncidentStateEnum = z.enum(['open', 'mitigated', 'resolved'])
const HealthStatusEnum = z.enum(['pass', 'warn', 'fail'])
const ErrorCodeEnum = z.enum(['SERVICE_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'RATE_LIMITED'])

const ServiceSchema = z
  .object({
    id: z.string().openapi({ example: 'svc_001' }),
    name: z.string().openapi({ example: 'checkout-api' }),
    status: ServiceStatusEnum.openapi({ example: 'degraded' }),
    region: z.string().openapi({ example: 'cn-hangzhou' }),
    version: z.string().openapi({ example: '2.4.1' }),
    dependencies: z.array(z.string()).openapi({ example: ['postgres-main', 'redis-cache'] }),
    lastDeployedAt: z.string().openapi({ example: '2026-10-01T08:00:00Z' }),
  })
  .openapi('Service')

const AssigneeSchema = z
  .object({
    id: z.string().openapi({ example: 'u_07' }),
    name: z.string().openapi({ example: '陈工' }),
    email: z.string().openapi({ example: 'chen@example.com' }),
  })
  .openapi('Assignee')

const ImpactSchema = z
  .object({
    usersAffected: z.number().int().openapi({ example: 1420 }),
    regions: z.array(z.string()).openapi({ example: ['华东', '华南'] }),
  })
  .openapi('Impact')

const IncidentSchema = z
  .object({
    id: z.string().openapi({ example: 'inc_001' }),
    title: z.string().openapi({ example: '支付回调延迟升高' }),
    severity: SeverityEnum.openapi({ example: 'sev2' }),
    state: IncidentStateEnum.openapi({ example: 'open' }),
    openedAt: z.string().openapi({ example: '2026-10-02T03:12:00Z' }),
    // nullable 验证点：未解决事件 resolvedAt 为 null → 页面必须渲染占位符（A1/A2）
    resolvedAt: z.string().nullable().openapi({ example: null }),
    assignee: AssigneeSchema,
    impact: ImpactSchema,
  })
  .openapi('Incident')

const HealthCheckSchema = z
  .object({
    name: z.string().openapi({ example: 'db-connect' }),
    passed: z.boolean().openapi({ example: true }),
    latencyMs: z.number().int().openapi({ example: 12 }),
    message: z.string().openapi({ example: '连接池正常' }),
  })
  .openapi('HealthCheck')

// 200 分支
const HealthOkSchema = z
  .object({
    status: HealthStatusEnum.openapi({ example: 'pass' }),
    checks: z.array(HealthCheckSchema).openapi({ example: [] }),
  })
  .openapi('HealthOk')

// 503 分支 —— 刻意包在 data 下，与 200 分支同前缀（spec §3.3）
const HealthErrorSchema = z
  .object({
    code: ErrorCodeEnum.openapi({ example: 'SERVICE_UNAVAILABLE' }),
    message: z.string().openapi({ example: '下游依赖 postgres-main 不可用' }),
    retryAfterSeconds: z.number().int().openapi({ example: 30 }),
    contact: z.string().openapi({ example: 'oncall@example.com' }),
  })
  .openapi('HealthError')

const NewIncidentNoteSchema = z
  .object({ body: z.string().openapi({ example: '已扩容并观察 30 分钟' }) })
  .openapi('NewIncidentNote')

const IncidentNoteSchema = z
  .object({
    id: z.string().openapi({ example: 'note_001' }),
    body: z.string().openapi({ example: '已扩容并观察 30 分钟' }),
    createdAt: z.string().openapi({ example: '2026-10-02T06:00:00Z' }),
  })
  .openapi('IncidentNote')

const listServicesRoute = createRoute({
  method: 'get',
  path: '/services',
  operationId: 'listServices',
  tags: ['services'],
  summary: '服务列表',
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(ServiceSchema) } } },
  },
})

const listIncidentsRoute = createRoute({
  method: 'get',
  path: '/services/{serviceId}/incidents',
  operationId: 'listServiceIncidents',
  tags: ['incidents'],
  summary: '服务事件列表',
  request: { params: z.object({ serviceId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(IncidentSchema) } } },
  },
})

// ★ 核心：同 path 双状态码
const serviceHealthRoute = createRoute({
  method: 'get',
  path: '/services/{name}/health',
  operationId: 'getServiceHealth',
  tags: ['health'],
  summary: '服务健康检查（200 / 503 双分支）',
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: HealthOkSchema } } },
    503: { description: 'Service Unavailable', content: { 'application/json': { schema: HealthErrorSchema } } },
  },
})

const createIncidentNoteRoute = createRoute({
  method: 'post',
  path: '/incidents/{incidentId}/notes',
  operationId: 'createIncidentNote',
  tags: ['incidents'],
  summary: '追加事件备注（201 回显）',
  request: { params: z.object({ incidentId: z.string() }), body: { content: { 'application/json': { schema: NewIncidentNoteSchema } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: IncidentNoteSchema } } },
  },
})

const SERVICES = [
  {
    id: 'svc_001', name: 'checkout-api', status: 'degraded' as const, region: 'cn-hangzhou', version: '2.4.1',
    dependencies: ['postgres-main', 'redis-cache'], lastDeployedAt: '2026-10-01T08:00:00Z',
  },
  {
    id: 'svc_002', name: 'user-profile', status: 'healthy' as const, region: 'cn-hangzhou', version: '1.9.7',
    dependencies: ['postgres-main'], lastDeployedAt: '2026-09-28T11:30:00Z',
  },
]

const INCIDENTS = [
  {
    id: 'inc_001', title: '支付回调延迟升高', severity: 'sev2' as const, state: 'open' as const,
    openedAt: '2026-10-02T03:12:00Z', resolvedAt: null, // nullable 验证点
    assignee: { id: 'u_07', name: '陈工', email: 'chen@example.com' },
    impact: { usersAffected: 1420, regions: ['华东', '华南'] },
  },
  {
    id: 'inc_002', title: '报表导出超时', severity: 'sev3' as const, state: 'resolved' as const,
    openedAt: '2026-09-20T07:00:00Z', resolvedAt: '2026-09-20T11:20:00Z',
    assignee: { id: 'u_12', name: '刘工', email: 'liu@example.com' },
    impact: { usersAffected: 35, regions: ['华北'] },
  },
]

export const app = new OpenAPIHono()

app.openapi(listServicesRoute, (c) => c.json(SERVICES, 200))

app.openapi(listIncidentsRoute, (c) => {
  const { serviceId } = c.req.valid('param')
  void serviceId
  return c.json(INCIDENTS, 200)
})

// 503 触发条件：服务名含 'down' → 走错误分支（页面 HealthChecker 会请求该服务名）
app.openapi(serviceHealthRoute, (c) => {
  const { name } = c.req.valid('param')
  if (name.includes('down')) {
    return c.json(
      { code: 'SERVICE_UNAVAILABLE' as const, message: '下游依赖 postgres-main 不可用', retryAfterSeconds: 30, contact: 'oncall@example.com' },
      503,
    )
  }
  return c.json(
    {
      status: 'pass' as const,
      checks: [
        { name: 'db-connect', passed: true, latencyMs: 12, message: '连接池正常' },
        { name: 'cache-ping', passed: true, latencyMs: 4, message: '缓存命中正常' },
      ],
    },
    200,
  )
})

app.openapi(createIncidentNoteRoute, (c) => {
  const body = c.req.valid('json')
  return c.json({ id: `note_${Date.now()}`, body: body.body, createdAt: new Date().toISOString() }, 201)
})

app.doc('/doc', {
  openapi: '3.0.3',
  info: { title: 'nx-mk devops incidents API', version: '0.1.0', description: '验证项目三：错误响应 + 同 path 多状态码' },
})

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT ?? 8803)
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[incidents/server] listening on http://localhost:${info.port}`)
  })
}