/**
 * @nx-mk-example/medical-server —— 医疗记录后端（验证项目一）
 *
 * 形状族（spec §3.1）：对象嵌套 / $ref 复用 / enum / nullable / 数组内嵌数组。
 * 响应体统一包在 data 下（demo 同构）—— manifest 以 'data' 为根走 walkSchema，
 * 故 normalizedPath 形如 data.contact.phone、data[].medications[].name。
 *
 * P1：路径参数 {patientId} 不进 coverage 分母，页面无需渲染它。
 * P1 + C1 回显设计：POST /patients 的 201 体回显写入值，供页面渲染同一路径。
 * 真 100% 口径（G1）：不造 4xx/5xx 响应体 —— 每个响应 schema 字段都需被渲染，
 * 错误响应验证由项目三专责。
 */
import { serve } from '@hono/node-server'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const ContactSchema = z
  .object({
    phone: z.string().openapi({ example: '+86-13800138000' }),
    email: z.string().openapi({ example: 'alice@example.com' }),
  })
  .openapi('Contact')

const EmergencyContactSchema = z
  .object({
    name: z.string().openapi({ example: '张伟' }),
    relation: z.string().openapi({ example: '父子' }),
  })
  .openapi('EmergencyContact')

const InsuranceSchema = z
  .object({
    policyNumber: z.string().openapi({ example: 'POL-2024-8891' }),
    expiryDate: z.string().openapi({ example: '2027-03-31' }),
  })
  .openapi('Insurance')

const GenderEnum = z.enum(['male', 'female', 'other'])
const BloodTypeEnum = z.enum(['A', 'B', 'O', 'AB'])
const DepartmentEnum = z.enum(['cardiology', 'neurology', 'general'])

const PatientSchema = z
  .object({
    id: z.string().openapi({ example: 'p_001' }),
    name: z.string().openapi({ example: 'Alice Chen' }),
    birthDate: z.string().openapi({ example: '1988-04-12' }),
    gender: GenderEnum.openapi({ example: 'female' }),
    bloodType: BloodTypeEnum.openapi({ example: 'O' }),
    contact: ContactSchema,
    emergencyContact: EmergencyContactSchema,
    insurance: InsuranceSchema,
    lastVisitAt: z.string().openapi({ example: '2026-09-28T09:12:00Z' }),
    notes: z.string().nullable().openapi({ example: '轻度高血压，随访中' }),
  })
  .openapi('Patient')

const VitalSignsSchema = z
  .object({
    heartRate: z.number().int().openapi({ example: 72 }),
    heightCm: z.number().openapi({ example: 168 }),
    weightKg: z.number().openapi({ example: 61.5 }),
  })
  .openapi('VitalSigns')

const MedicationSchema = z
  .object({
    name: z.string().openapi({ example: '氨氯地平' }),
    dosage: z.string().openapi({ example: '5mg qd' }),
    prescribed: z.boolean().openapi({ example: true }),
  })
  .openapi('Medication')

const VisitSchema = z
  .object({
    id: z.string().openapi({ example: 'v_001' }),
    visitAt: z.string().openapi({ example: '2026-09-28T09:12:00Z' }),
    department: DepartmentEnum.openapi({ example: 'cardiology' }),
    diagnosis: z.string().openapi({ example: '原发性高血压' }),
    vitals: VitalSignsSchema,
    medications: z.array(MedicationSchema).openapi({
      example: [{ name: '氨氯地平', dosage: '5mg qd', prescribed: true }],
    }),
  })
  .openapi('Visit')

const NewPatientSchema = z
  .object({
    name: z.string().openapi({ example: 'Bob Li' }),
    birthDate: z.string().openapi({ example: '1992-11-03' }),
  })
  .openapi('NewPatient')

// 回显体：写入值必须出现在响应里，页面才能用同一 normalizedPath 覆盖
const CreatedPatientSchema = z
  .object({
    id: z.string().openapi({ example: 'p_new' }),
    name: z.string().openapi({ example: 'Bob Li' }),
    createdAt: z.string().openapi({ example: '2026-10-04T10:00:00Z' }),
  })
  .openapi('CreatedPatient')

const getPatientRoute = createRoute({
  method: 'get',
  path: '/patients/{patientId}',
  operationId: 'getPatient',
  tags: ['patients'],
  summary: '患者详情',
  request: { params: z.object({ patientId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: PatientSchema } } },
  },
})

const listVisitsRoute = createRoute({
  method: 'get',
  path: '/patients/{patientId}/visits',
  operationId: 'listPatientVisits',
  tags: ['visits'],
  summary: '患者就诊记录',
  request: { params: z.object({ patientId: z.string() }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.array(VisitSchema) } } },
  },
})

const createPatientRoute = createRoute({
  method: 'post',
  path: '/patients',
  operationId: 'createPatient',
  tags: ['patients'],
  summary: '新建患者（201 回显写入值）',
  request: { body: { content: { 'application/json': { schema: NewPatientSchema } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: CreatedPatientSchema } } },
  },
})

type Visit = {
  id: string
  visitAt: string
  department: 'cardiology' | 'neurology' | 'general'
  diagnosis: string
  vitals: { heartRate: number; heightCm: number; weightKg: number }
  medications: { name: string; dosage: string; prescribed: boolean }[]
}

function makeVisit(
  id: string,
  visitAt: string,
  department: Visit['department'],
  diagnosis: string,
  heartRate: number,
  heightCm: number,
  weightKg: number,
  medications: Visit['medications'],
): Visit {
  return { id, visitAt, department, diagnosis, vitals: { heartRate, heightCm, weightKg }, medications }
}

const PATIENTS = [
  {
    id: 'p_001',
    name: 'Alice Chen',
    birthDate: '1988-04-12',
    gender: 'female' as const,
    bloodType: 'O' as const,
    contact: { phone: '+86-13800138000', email: 'alice@example.com' },
    emergencyContact: { name: '张伟', relation: '父子' },
    insurance: { policyNumber: 'POL-2024-8891', expiryDate: '2027-03-31' },
    lastVisitAt: '2026-09-28T09:12:00Z',
    notes: '轻度高血压，随访中',
  },
  {
    id: 'p_002',
    name: 'Bob Li',
    birthDate: '1992-11-03',
    gender: 'male' as const,
    bloodType: 'A' as const,
    contact: { phone: '+86-13900139000', email: 'bob@example.com' },
    emergencyContact: { name: '李静', relation: '母女' },
    insurance: { policyNumber: 'POL-2025-1204', expiryDate: '2026-12-31' },
    // 与本例唯一的就诊记录 v_003 对齐（schema 里 lastVisitAt 是必填）
    lastVisitAt: '2026-08-15T14:30:00Z',
    // nullable 验证点：notes 为 null → 页面必须渲染占位符（A1/A2，否则 suspicious）
    notes: null,
  },
]

const VISITS: Record<string, Visit[]> = {
  p_001: [
    makeVisit('v_001', '2026-09-28T09:12:00Z', 'cardiology', '原发性高血压', 72, 168, 61.5, [
      { name: '氨氯地平', dosage: '5mg qd', prescribed: true },
      { name: '缬沙坦', dosage: '80mg qd', prescribed: true },
    ]),
    makeVisit('v_002', '2026-06-14T10:00:00Z', 'general', '年度体检', 68, 168, 62.1, [
      { name: '维生素D', dosage: '400IU qd', prescribed: false },
    ]),
  ],
  // 空 medications 数组验证点：数组字段仍需渲染（渲染 '—' 占位，A1/A2）
  p_002: [makeVisit('v_003', '2026-08-15T14:30:00Z', 'neurology', '偏头痛', 78, 174, 70.4, [])],
}

export const app = new OpenAPIHono()

app.openapi(getPatientRoute, (c) => {
  const { patientId } = c.req.valid('param')
  const found = PATIENTS.find((p) => p.id === patientId)
  // 找不到时返回同 schema 的空值（而非 404 body）—— 避免新增响应 schema 拉高覆盖分母
  const empty = {
    id: '', name: '', birthDate: '1970-01-01', gender: 'other' as const, bloodType: 'AB' as const,
    contact: { phone: '', email: '' }, emergencyContact: { name: '', relation: '' },
    insurance: { policyNumber: '', expiryDate: '' }, lastVisitAt: '', notes: null,
  }
  return c.json(found ?? empty, 200)
})

app.openapi(listVisitsRoute, (c) => {
  const { patientId } = c.req.valid('param')
  return c.json(VISITS[patientId] ?? [], 200)
})

app.openapi(createPatientRoute, (c) => {
  const body = c.req.valid('json')
  return c.json({ id: `p_${Date.now()}`, name: body.name, createdAt: new Date().toISOString() }, 201)
})

app.doc('/doc', {
  openapi: '3.0.3',
  info: { title: 'nx-mk medical records API', version: '0.1.0', description: '验证项目一：嵌套关联 + enum + nullable' },
})

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.env.PORT ?? 8801)
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[medical/server] listening on http://localhost:${info.port}`)
  })
}