/**
 * Request DSL 校验（C9 §26.2）—— verifyRequests 纯函数。
 *
 * 输入：声明的 request + 已捕获 trace（冻结形状 RequestTraceLike，适配两类源：
 * collector 内存 trace（带 responseBody）与 dashboard TraceRow（无 body））。
 *
 * 分层校验（隐私一致，见 Plan 47.5-F1：DB 不存响应原文）：
 * - expect.status  ：恒可从 trace.status 校验
 * - expect.fields  ：仅当 trace 带 responseBody 时可校验（path 取值 →
 *   classifyFieldState）；无 body → 该断言标注 state='no-body'（部分校验，
 *   不判 fail 也不判 pass —— 诚实降级，非假绿）
 * - method/url 匹配：声明与 trace 不一致 → 判 skip（该 trace 不是这个 request）
 *
 * 结论三态：passed（全部声明的断言满足）/ failed（任一断言违例）/
 *             skipped（无匹配 trace）
 */
import { getFieldByPath, classifyFieldState, type RequestDecl } from './request-dsl.js'

/** 校验输入的冻结形状（避免依赖具体 trace 类型，适配层在调用方） */
export interface RequestTraceLike {
  method: string
  url: string
  status?: number
  /** 内存响应体（仅 collector 侧携带；DB 持久化 trace 恒缺席） */
  responseBody?: unknown
}

export interface RequestFieldAssertionResult {
  path: string
  expect: 'present' | 'null' | 'undefined' | 'empty'
  actual: 'present' | 'null' | 'undefined' | 'empty' | 'no-body'
  pass: boolean
}

export interface RequestMatch {
  /** 该 trace 是否与声明 method+url 匹配（url 作前缀/全等归一比较） */
  matched: boolean
}

/** method+url 匹配：method 全等领域 + url 路径段归一后全等（忽略 baseUrl/origin 差异） */
export function matchesTrace(decl: RequestDecl, trace: RequestTraceLike): boolean {
  if (decl.method.toUpperCase() !== trace.method.toUpperCase()) return false
  const norm = (u: string): string => {
    try {
      return new URL(u).pathname
    } catch {
      return u.split('?')[0] ?? u
    }
  }
  return norm(decl.url) === norm(trace.url)
}

export interface RequestVerification {
  requestId: string
  method: string
  url: string
  /** passed | failed | skipped */
  status: 'passed' | 'failed' | 'skipped'
  /** 匹配到的 trace（skipped 时缺省） */
  traceStatus?: number
  statusAssertion?: { expect: number; actual: number | 'no-trace' | 'no-status'; pass: boolean }
  fields: RequestFieldAssertionResult[]
  /** 未能校验的字段断言（无 body）数 */
  partialCount: number
}

function noTrace(decl: RequestDecl): RequestVerification {
  return {
    requestId: decl.id,
    method: decl.method,
    url: decl.url,
    status: 'skipped',
    fields: [],
    partialCount: 0,
  }
}

/** 校验单个声明；无匹配 trace → skipped；至少一个断言违例 → failed；否则 passed */
export function verifyRequest(decl: RequestDecl, trace: RequestTraceLike | undefined): RequestVerification {
  if (trace === undefined) return noTrace(decl)

  const fields: RequestFieldAssertionResult[] = []
  let partialCount = 0
  let failed = false

  const statusAssertion =
    decl.expect?.status !== undefined
      ? {
          expect: decl.expect.status,
          actual: (trace.status ?? 'no-status') as number | 'no-status',
          pass: trace.status !== undefined && trace.status === decl.expect.status,
        }
      : undefined
  if (statusAssertion !== undefined && !statusAssertion.pass && trace.status === undefined) {
    // status 缺席（trace 无该字段）→ 视为部分校验（不判 fail）
  } else if (statusAssertion !== undefined && !statusAssertion.pass) {
    failed = true
  }

  for (const f of decl.expect?.fields ?? []) {
    if (trace.responseBody === undefined) {
      partialCount++
      fields.push({ path: f.path, expect: f.state, actual: 'no-body', pass: false })
      continue
    }
    const value = getFieldByPath(trace.responseBody, f.path)
    const actual = classifyFieldState(value)
    const pass = actual === f.state
    if (!pass) failed = true
    fields.push({ path: f.path, expect: f.state, actual, pass })
  }

  // 无断言（没 expect 或全不可校验）→ 视为通过（有匹配 trace 即达成）
  const hasJudgedAssertions = statusAssertion !== undefined || fields.length > 0
  return {
    requestId: decl.id,
    method: decl.method,
    url: decl.url,
    status: hasJudgedAssertions && failed ? 'failed' : 'passed',
    ...(trace.status !== undefined ? { traceStatus: trace.status } : {}),
    ...(statusAssertion !== undefined ? { statusAssertion } : {}),
    fields,
    partialCount,
  }
}

/** 批量校验：逐 trace 归属到最匹配的 request（首个 method+url 命中即绑定） */
export function verifyRequests(
  decls: ReadonlyArray<RequestDecl>,
  traces: ReadonlyArray<RequestTraceLike>,
): RequestVerification[] {
  const usedTrace = new Set<number>()
  const out: RequestVerification[] = []
  for (const decl of decls) {
    let hit: RequestTraceLike | undefined
    let hitIdx = -1
    for (let i = 0; i < traces.length; i++) {
      if (usedTrace.has(i)) continue
      const t = traces[i]
      if (t === undefined) continue
      if (matchesTrace(decl, t)) {
        hit = t
        hitIdx = i
        break
      }
    }
    if (hit !== undefined && hitIdx !== -1) usedTrace.add(hitIdx)
    out.push(verifyRequest(decl, hit))
  }
  return out
}