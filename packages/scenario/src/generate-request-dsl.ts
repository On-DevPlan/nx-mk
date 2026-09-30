/**
 * dsl.generated.yml 生成器（C9 §26.2 / §11 产物 dsl.generated.yml）。
 *
 * 从已捕获 trace 反推 requests 声明：每个 trace（去重 by method+url）
 * 产出一条 RequestDecl（id=req_<seq>、from 缺省、method/url、expect.status）——
 * plan §26.2 语义：Request DSL 可复用、可断言；由采集记录自动落地免除手写。
 *
 * YAML 序列化用 yaml 包（与 dsl-loader 同依赖，D2 不新增）；导出为纯函数，
 * CLI 接线（写 .nx-mk/runs/{runId}/dsl.generated.yml）在本批后置。
 */
import { stringify } from 'yaml'
import type { RequestDecl } from './request-dsl.js'
import type { RequestTraceLike } from './verify-requests.js'

export interface GeneratedRequest {
  /** 按声明顺序编号，保持可读 */
  id: string
  request: RequestDecl
}

/** 去重（method+url 归一后全等）后按出现顺序生成声明 */
export function generateRequestDslFromTraces(traces: ReadonlyArray<RequestTraceLike>): GeneratedRequest[] {
  const seen = new Set<string>()
  const out: GeneratedRequest[] = []
  let seq = 1
  for (const t of traces) {
    if (t.status !== undefined && t.status >= 400) continue // 失败请求不进可复用声明
    const normMethod = t.method.toUpperCase()
    let normUrl = t.url
    try {
      normUrl = new URL(t.url).pathname
    } catch {
      /* 保持原文 */
    }
    const key = `${normMethod} ${normUrl}`
    if (seen.has(key)) continue
    seen.add(key)
    const request: RequestDecl = {
      id: `req_${String(seq++).padStart(3, '0')}`,
      method: normMethod,
      url: t.url,
      expect: t.status !== undefined ? { status: t.status } : undefined,
    }
    out.push({ id: request.id, request })
  }
  return out
}

/** 生成磁盘形状：version 1 + requests[]（与 RequestDeclFileSchema 对齐，可直接 loadRequests 读回） */
export function renderRequestDslYaml(decls: ReadonlyArray<RequestDecl>): string {
  return stringify(
    { version: 1, requests: decls.map((r) => ({ id: r.id, method: r.method, url: r.url, ...(r.expect !== undefined ? { expect: r.expect } : {}) })) },
    { lineWidth: 0 },
  )
}