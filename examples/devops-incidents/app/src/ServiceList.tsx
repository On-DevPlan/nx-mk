/**
 * 服务列表 —— 覆盖 GET /services 响应 schema 的全部 7 个 manifest 路径
 * （6 个叶子 + 1 个数组 dependencies）。
 *
 * A1/A2（空值防护）：字符串用 ||（无 0 等数字边界），确保 Field 子节点永不为空串。
 * A3（textSample === 字段名末段 → weak）：enum 映射中文标签（status: 健康/降级/宕机），
 *   渲染文本恒不等于末段。
 *
 * dependencies 是 array-of-primitive（string[]），manifest 路径形态 data[].dependencies[]
 * （带 [] 后缀）—— 元素在分母里。空数组时仍渲染一个占位 Field，否则该路径无 evidence → missing。
 *
 * generateSdk 不会把 nullable 标注泄露到客户端类型，TS 不会提醒 null 防护 —— 但本端点的
 * schema 字段全部非空（service 列表无 nullable 字段），不需要兜底算子重活。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type Service } from './generated-sdk.js'

const DASH = '—'
const STATUS_LABEL: Record<string, string> = { healthy: '健康', degraded: '降级', down: '宕机' }

export function ServiceList() {
  const [services, setServices] = useState<Service[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.services.listServices({}).then(setServices).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  if (error) return <section data-page="services-error">加载失败：{error}</section>
  if (!services) return <section data-page="services-loading">加载中…</section>

  return (
    <section data-page="service-list">
      <h2>服务列表（{services.length} 个）</h2>
      <ol>
        {services.map((s) => {
          // 局部变量带 Text 后缀，不取字段末段同名（A3 静态检查的前提）
          const idText = s.id || DASH
          const nameText = s.name || DASH
          const statusText = s.status ? (STATUS_LABEL[s.status] ?? s.status) : DASH
          const regionText = s.region || DASH
          const versionText = s.version || DASH
          // array-of-primitive → 数组元素字段进分母。空数组时也渲染一个占位 Field，
          // 否则该路径在本次 run 里零 evidence → missing（medical-records 的教训）。
          const depsText = (s.dependencies ?? []).join(', ') || DASH
          const lastDeployedText = s.lastDeployedAt || DASH
          return (
            <li key={s.id}>
              <div>
                {/* A3：渲染服务 id 值本身（'svc_001'），不等于末段 'id' */}
                <Field field="data[].id">{idText}</Field>
                {' · '}
                <Field field="data[].name">{nameText}</Field>
                {' · '}
                <Field field="data[].status">{statusText}</Field>
              </div>
              <div>
                区域 <Field field="data[].region">{regionText}</Field>
                {' · 版本 '}
                <Field field="data[].version">{versionText}</Field>
                {' · 上次部署 '}
                <Field field="data[].lastDeployedAt">{lastDeployedText}</Field>
              </div>
              <div>
                依赖：
                {/* 三层数组叶：data[].dependencies（array-of-primitive 带 []） */}
                <Field field="data[].dependencies[]">{depsText}</Field>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}