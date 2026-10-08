/**
 * 健康检查 —— 验证同 path 双状态码的字段覆盖（spec §3.3 / C2 绕行）。
 *
 * 关键机制（spec §2 约束 C2 + P4/P5）：
 * - 503 走**原生 fetch**（`fetch('/api/services/{name}/health')`）—— SDK 对非 2xx 直接
 *   throw 且不解析响应体，故错误体只能靠原生 fetch 拿到；
 * - 拿到错误体后**必须渲染成带 data-mk-field 的可见元素** —— ui_evidence 来自 DOM 扫描
 *   （scanner.ts querySelectorAll('[data-mk-field]')），与 HTTP 通道无关（P5）；
 * - 覆盖判定 `accessHit || uiHit`（coverage-analyzer.ts:102），故无 field hit 也能 covered（P4）。
 *
 * A1/A2/A3：错误卡的四个字段全部过 DASH 兜底；code 映射为可读中文（避免 A3 弱判定）。
 * S2 自驱动：mount 即同时请求正常服务与故障服务，两条分支都在同一页渲染。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api } from './generated-sdk.js'

const DASH = '—'
const CODE_LABEL: Record<string, string> = {
  SERVICE_UNAVAILABLE: '服务不可用',
  UPSTREAM_TIMEOUT: '上游超时',
  RATE_LIMITED: '触发限流',
}
const CHECK_STATUS_LABEL: Record<string, string> = { pass: '正常', warn: '告警', fail: '失败' }

/** 200 分支的错误体类型（原生 fetch 路径，绕开 SDK 的非 2xx throw） */
type HealthError = {
  code: string
  message: string
  retryAfterSeconds: number
  contact: string
} | null

export function HealthChecker() {
  const [okChecks, setOkChecks] = useState<{ name: string; passed: boolean; latencyMs: number; message: string }[] | null>(null)
  const [okStatus, setOkStatus] = useState<string | null>(null)
  const [errBody, setErrBody] = useState<HealthError>(null)

  useEffect(() => {
    // 200 分支走 SDK（正常路径）
    api.health.getServiceHealth({ name: 'checkout-api' }).then((h) => {
      setOkStatus(h.status)
      setOkChecks(h.checks ?? [])
    }).catch(() => {
      /* 正常服务不该失败；失败则 200 分支字段无 evidence，由验收脚本暴露 */
    })

    // ★ 503 分支走原生 fetch —— SDK 会 throw（P4/C2），只有原生路径能拿到响应体。
    // 路径带 /api 前缀（scanner.ts 的 shim 只观测 /api 前缀，保证 request_traces 非空）。
    fetch('/api/services/down-api/health')
      .then(async (res) => {
        if (res.status !== 503) return
        setErrBody((await res.json()) as HealthError)
      })
      .catch(() => {
        /* 网络层失败：错误分支字段无 evidence，由验收脚本暴露 */
      })
  }, [])

  return (
    <section data-page="health-checker">
      <h2>健康检查</h2>

      {/* 200 分支 */}
      <div data-testid="health-ok">
        <h3>正常服务 checkout-api</h3>
        <p>
          总体状态：
          <Field field="data.status">{okStatus ? (CHECK_STATUS_LABEL[okStatus] ?? okStatus) : DASH}</Field>
        </p>
        <ul>
          {(okChecks ?? []).map((c) => (
            <li key={c.name}>
              {/* A3：渲染 c.name 值（'db-connect'），不等于末段 'name' */}
              <Field field="data.checks[].name">{c.name || DASH}</Field>
              {' · '}
              {/* A3/A2：布尔渲染 '通过'/'未通过'，非 'passed' */}
              <Field field="data.checks[].passed">{c.passed ? '通过' : '未通过'}</Field>
              {' · '}
              <Field field="data.checks[].latencyMs">{String(c.latencyMs ?? DASH)}</Field>
              {' ms · '}
              <Field field="data.checks[].message">{c.message || DASH}</Field>
            </li>
          ))}
        </ul>
      </div>

      {/* ★ 503 分支 —— 错误卡。四个字段必须全部渲染，否则该 503 响应的字段判 missing。 */}
      <div data-testid="health-error" data-page="health-error">
        <h3>故障服务 down-api（503 错误分支）</h3>
        {errBody ? (
          <dl>
            <dt>错误码</dt>
            {/* A3：CODE_LABEL 映射中文，避免渲染值等于末段 'code' */}
            <dd>
              <Field field="data.code">{errBody.code ? (CODE_LABEL[errBody.code] ?? errBody.code) : DASH}</Field>
            </dd>
            <dt>错误信息</dt>
            <dd><Field field="data.message">{errBody.message || DASH}</Field></dd>
            <dt>建议重试间隔</dt>
            <dd>
              <Field field="data.retryAfterSeconds">{String(errBody.retryAfterSeconds ?? DASH)}</Field>
              {' 秒'}
            </dd>
            <dt>联系邮箱</dt>
            <dd><Field field="data.contact">{errBody.contact || DASH}</Field></dd>
          </dl>
        ) : (
          <p>正在探测故障服务…</p>
        )}
      </div>
    </section>
  )
}