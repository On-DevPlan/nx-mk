/**
 * 就诊记录 —— 覆盖 GET /patients/{patientId}/visits 响应 schema 的全部 11 个 manifest 路径
 * （10 个叶子 + 1 个嵌套对象 data[].vitals）。
 *
 * P3（数组路径）：field 值用 manifest 归一化形态 `data[].x`，不是下标形态。
 *   顶层数组元素 → `data[].id`；嵌套数组元素 → `data[].medications[].name`。
 *   analyzer 的 evidence 索引键就是 normalizedPath（coverage-analyzer.ts:95,100,101，
 *   按 f.normalizedPath 查），故字面量必须逐字符命中，多条 evidence 取最差质量。
 * A1/A2（空值防护）：vitals 走 String(x ?? DASH)，0 也是有效渲染（String(0)='0'），
 *   用 ?? 而非 || —— 否则 heartRate=0 会被吞成 '—'，虽不算 suspicious 但失真。
 * A3（weak 防护）：enum 映射中文标签、布尔渲染'在服用'/'已停用'，均不等于末段。
 *
 * 空数组兜底 —— 与计划的一处偏离（计划只给 name 兜底，遗漏 dosage/prescribed）：
 *   server 对 p_002 的 v_003 返回 medications: []，而 coverage 是「一条 evidence 都没有」
 *   判 missing，页面上渲染几个元素不影响该路径是否命中。故空数组时三个 medication 字段
 *   都要各自渲染占位 —— 只兜 name 会让 dosage/prescribed 在该次采集里无 evidence → missing。
 *
 * generateSdk 丢弃可空性（vitals/medications 生成类型均为非空），TS 不会提醒 null 防护；
 * server 的 not-found 分支返回空数组，故 ?. 与 ?? [] 兜底是刻意写的。
 *
 * patientId 由 main.tsx 传入且两个患者都渲染：p_002 的 v_003 是 medications: [] 的
 * 唯一载体（空数组兜底分支），固定请求 p_001 会让该分支在运行时不可达
 * （场景 DSL 无 click，无法切路由）。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type Visit } from './generated-sdk.js'

const DASH = '—'
const DEPARTMENT_LABEL: Record<string, string> = {
  cardiology: '心血管科',
  neurology: '神经内科',
  general: '全科',
}

/** 生命体征三值 —— 0 是合法测量值，故用 ?? 而非 ||（String(0) = '0' 非空，A1/A2 安全） */
function formatVital(v: number | undefined): string {
  return String(v ?? DASH)
}

export function VisitHistory({ patientId }: { patientId: string }) {
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setVisits(null)
    setError(null)
    api.visits
      .listPatientVisits({ patientId })
      .then(setVisits)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [patientId])

  if (error) return <section data-page={`visits-error-${patientId}`}>加载失败：{error}</section>
  if (!visits) return <section data-page={`visits-loading-${patientId}`}>加载中…</section>

  return (
    <section data-page={`visit-history-${patientId}`}>
      <h2>就诊记录（{patientId} · {visits.length} 次）</h2>
      {visits.length === 0 && <p>暂无就诊记录</p>}
      <ol>
        {visits.map((visit) => {
          const meds = visit.medications ?? []
          // 局部变量带 Text 后缀，不取字段末段同名 —— 让 verify-pages.mjs 的 A3 静态检查真正成立
          const heartRateText = formatVital(visit.vitals?.heartRate)
          const heightCmText = formatVital(visit.vitals?.heightCm)
          const weightKgText = formatVital(visit.vitals?.weightKg)
          return (
            <li key={visit.id} data-visit-id={visit.id}>
              <div>
                {/* A3：渲染 visit id 值本身（'v_001'），不等于末段 'id' */}
                <Field field="data[].id">{visit.id || DASH}</Field>
                {' · '}
                <Field field="data[].visitAt">{visit.visitAt || DASH}</Field>
                {' · '}
                <Field field="data[].department">
                  {visit.department ? (DEPARTMENT_LABEL[visit.department] ?? visit.department) : DASH}
                </Field>
              </div>
              <div>
                诊断：
                <Field field="data[].diagnosis">{visit.diagnosis || DASH}</Field>
              </div>
              <div>
                生命体征：
                <Field field="data[].vitals.heartRate">{heartRateText}</Field>
                {' bpm / '}
                <Field field="data[].vitals.heightCm">{heightCmText}</Field>
                {' cm / '}
                <Field field="data[].vitals.weightKg">{weightKgText}</Field>
                {' kg'}
              </div>
              {/* 对象级：data[].vitals。walkSchema 对 array 元素的 object 属性仍产父描述符，
                  故这条 required 路径在分母里 —— 与三个叶子一并渲染。 */}
              <div>
                生命体征汇总：
                <Field field="data[].vitals">
                  {`（${heartRateText} bpm · ${heightCmText} cm · ${weightKgText} kg）`}
                </Field>
              </div>
              <div>
                用药：
                {/* A1/A2：空数组时三个 medication 字段各自渲染占位 —— 全部都要，
                    只兜 name 会让 dosage/prescribed 无 evidence → missing */}
                {meds.length > 0 ? (
                  <ul>
                    {meds.map((med) => (
                      <li key={med.name}>
                        <Field field="data[].medications[].name">{med.name || DASH}</Field>
                        {' '}
                        <Field field="data[].medications[].dosage">{med.dosage || DASH}</Field>
                        {' '}
                        {/* A3：布尔渲染 '在服用'/'已停用'，不等于末段 'prescribed' */}
                        <Field field="data[].medications[].prescribed">
                          {med.prescribed ? '在服用' : '已停用'}
                        </Field>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <Field field="data[].medications[].name">{DASH}</Field>
                    {' '}
                    <Field field="data[].medications[].dosage">{DASH}</Field>
                    {' '}
                    <Field field="data[].medications[].prescribed">{DASH}</Field>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
