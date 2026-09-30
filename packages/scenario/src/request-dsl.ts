/**
 * Request DSL（§26.2，C9）—— `requests:` 段 schema + 类型。
 *
 * 独立于 `scenarios:` 的断言声明：从某个 scenario/step 出发，对一次 API 请求
 * 作 endpoint/method/url 声明 + expect（status + fields[].path/state）断言。
 *
 * 向后兼容：并入 ScenarioFileSchema 时以 `requests?` 可选段存在——
 * 只有 `scenarios:` 的既有文件解析不变（v0 行为保持）。
 *
 * state 语义（与 §23.2 RequestFieldTrace.valueState 对齐，值为浏览器内字段特征）：
 * - present  值存在且非空
 * - null     null
 * - undefined 缺 key / undefined
 * - empty    空串 / 空数组 / 空对象
 */
import { z } from 'zod'

// 请求 id：kebab-case（与 scenario id 同规）
const RequestIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'request id must be kebab-case')

const RequestValuesStateSchema = z.enum(['present', 'null', 'undefined', 'empty'])

export const RequestExpectFieldSchema = z.object({
  path: z.string().min(1),        // 字段路径（normalizedPath 域，如 data.name）
  state: RequestValuesStateSchema,
})
export type RequestExpectField = z.infer<typeof RequestExpectFieldSchema>

export const RequestDeclSchema = z.object({
  id: RequestIdSchema,
  /** 来源归属：触发该请求的 scenario/step（可选——独立请求声明可省略） */
  from: z
    .object({
      scenarioId: z.string().min(1),
      stepId: z.string().optional(),
    })
    .optional(),
  endpointId: z.string().optional(), // manifest endpoint id（可选——按 method+url 匹配也可）
  method: z.string().min(1),        // GET/POST/PUT/PATCH/DELETE/HEAD
  url: z.string().min(1),           // 完整 URL（可含 query）
  auth: z.object({ type: z.literal('browserSession').or(z.string().min(1)) }).optional(),
  expect: z
    .object({
      status: z.number().int().min(100).max(599).optional(),
      fields: z.array(RequestExpectFieldSchema).optional(),
    })
    .optional(),
})
export type RequestDecl = z.infer<typeof RequestDeclSchema>

export const RequestDeclFileSchema = z.object({
  version: z.literal(1),
  requests: z.array(RequestDeclSchema).min(1),
})
export type RequestDeclFile = z.infer<typeof RequestDeclFileSchema>

/**
 * 字段 state 判定纯函数（§23.2 对齐）：给定提取到的值，判定属于哪个 state。
 * 供 verifyRequests 使用；null 占先（显式 null ≠ 空），undefined/缺 key 归 undefined，
 * 空串/空数组/空对象归 empty，其余 present。
 */
export function classifyFieldState(value: unknown): 'present' | 'null' | 'undefined' | 'empty' {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value.length === 0 ? 'empty' : 'present'
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : 'present'
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    return Object.keys(o).length === 0 ? 'empty' : 'present'
  }
  return 'present'
}

/** 点路径取值（data.name → data['name']；数组段按 index 或空索引）。找不到 key → undefined */
export function getFieldByPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}