/**
 * 患者详情 —— 覆盖 GET /patients/{patientId} 响应 schema 的全部 16 个 manifest 路径
 * （13 个叶子 + 3 个嵌套对象本身，见下方「对象级字段」）。
 *
 * A1（空 span → visible:false → suspicious，不算 hit）：每个值都过一次兜底算子，
 *   保证 span 内恒有非零可见文本。
 * A2（空 textSample → weak）：同上，兜底产出的 '—' 非空。
 * A3（textSample === 字段名末段 → weak）：enum 值映射成中文标签，对象级字段渲染叶子摘要，
 *   渲染文本恒不等于末段（'name' / 'gender' / 'contact' …）。
 * P2：field 值逐字等于 manifest 的 normalizedPath（如 data.contact.phone）。
 * P1：路径参数 patientId 不进 coverage 分母，无需渲染。
 *
 * 对象级字段（本页 3 个：data.contact / data.emergencyContact / data.insurance）——
 *   schema-walker 对 plain object 属性会产父描述符（对 array-of-object 不会），
 *   故这三条 required 路径在分母里。不渲染 → requiredCoverage 永远到不了 1。
 *   渲染成「叶子摘要」而非空 span 或裸 JSON：
 *     - 空 span 会踩 A1（比不渲染更糟：既丢覆盖又进 suspicious 清单）
 *     - 裸 JSON.stringify 可读性差，且 null 成员会渲染出 "null"
 *   叶子与摘要共用同一个已兜底的局部变量 —— 结构上杜绝两者显示不一致。
 *
 * 局部变量统一带 Text 后缀（nameText 而非 name）：A3 的静态近似检查
 * （verify-pages.mjs）无法区分「字面量字符串」与「同名标识符引用」，
 * 故禁止把局部变量取成字段末段同名，让静态断言真正成立而非靠豁免。
 *
 * generateSdk 丢弃可空性（spec 声明 notes: string | null，生成类型却是 notes: string），
 * 故 TS 不会提醒 null 防护 —— server 对 p_002 的 notes 真的返回 null，
 * React 渲染 null 得到空 span。下面的兜底是刻意写的，不依赖类型系统兜底。
 *
 * patientId 由 main.tsx 传入且两个患者都渲染：p_002 是 notes=null 分支的唯一载体，
 * 固定请求 p_001 会让该分支在运行时不可达（场景 DSL 无 click，无法切路由）。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type Patient } from './generated-sdk.js'

/** 空值占位符 —— A1/A2：保证 Field 子节点永不为空串（空 span → suspicious） */
const DASH = '—'

/** enum 值 → 中文标签。A3：渲染文本不等于字段名末段（'gender' / 'bloodType'），故做映射 */
const GENDER_LABEL: Record<string, string> = { male: '男', female: '女', other: '其他' }
const BLOOD_LABEL: Record<string, string> = { A: 'A 型', B: 'B 型', O: 'O 型', AB: 'AB 型' }

export function PatientDetail({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPatient(null)
    setError(null)
    api.patients
      .getPatient({ patientId })
      .then(setPatient)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [patientId])

  if (error) return <section data-page={`patient-error-${patientId}`}>加载失败：{error}</section>
  if (!patient) return <section data-page={`patient-loading-${patientId}`}>加载中…</section>

  // 每个值只兜底一次，叶子 Field 与对象摘要共用同一个串 —— 结构上杜绝两者不一致。
  const nameText = patient.name || DASH
  const idText = patient.id || DASH
  const birthDateText = patient.birthDate || DASH
  const genderText = patient.gender ? (GENDER_LABEL[patient.gender] ?? patient.gender) : DASH
  const bloodTypeText = patient.bloodType ? (BLOOD_LABEL[patient.bloodType] ?? patient.bloodType) : DASH
  const phoneText = patient.contact?.phone || DASH
  const emailText = patient.contact?.email || DASH
  const emergencyNameText = patient.emergencyContact?.name || DASH
  const emergencyRelationText = patient.emergencyContact?.relation || DASH
  const policyNumberText = patient.insurance?.policyNumber || DASH
  const expiryDateText = patient.insurance?.expiryDate || DASH
  const lastVisitAtText = patient.lastVisitAt || DASH
  // A1/A2 关键点：p_002 的 notes 是 null —— 兜底成 DASH 而非空 span（visible:false → suspicious）。
  // 该分支由 main.tsx 渲染 PatientDetail patientId="p_002" 保证在运行时真实走到。
  // generateSdk 丢了 notes 的可空性，TS 视其为非空 string，不会提醒这里的 null 防护。
  const notesText = patient.notes || DASH

  return (
    <section data-page={`patient-detail-${patientId}`}>
      <h2>患者详情（{patientId}）</h2>
      <dl>
        <dt>姓名</dt>
        <dd><Field field="data.name">{nameText}</Field></dd>

        <dt>编号</dt>
        <dd><Field field="data.id">{idText}</Field></dd>

        <dt>出生日期</dt>
        <dd><Field field="data.birthDate">{birthDateText}</Field></dd>

        {/* A3：GENDER_LABEL 映射后的中文标签 ≠ 'gender' */}
        <dt>性别</dt>
        <dd><Field field="data.gender">{genderText}</Field></dd>

        <dt>血型</dt>
        <dd><Field field="data.bloodType">{bloodTypeText}</Field></dd>

        {/* ─── 嵌套对象 contact：2 个叶子 + 1 个对象级字段 ─── */}
        <dt>联系电话</dt>
        <dd><Field field="data.contact.phone">{phoneText}</Field></dd>

        <dt>联系邮箱</dt>
        <dd><Field field="data.contact.email">{emailText}</Field></dd>

        <dt>联系方式（汇总）</dt>
        {/* 对象级：data.contact。摘要恒非空且 ≠ 'contact'，故 valid */}
        <dd><Field field="data.contact">{`（${phoneText} · ${emailText}）`}</Field></dd>

        {/* ─── 嵌套对象 emergencyContact ─── */}
        <dt>紧急联系人</dt>
        <dd><Field field="data.emergencyContact.name">{emergencyNameText}</Field></dd>

        <dt>与患者关系</dt>
        <dd><Field field="data.emergencyContact.relation">{emergencyRelationText}</Field></dd>

        <dt>紧急联系人（汇总）</dt>
        <dd>
          <Field field="data.emergencyContact">
            {`（${emergencyNameText} · ${emergencyRelationText}）`}
          </Field>
        </dd>

        {/* ─── 嵌套对象 insurance ─── */}
        <dt>保单号</dt>
        <dd><Field field="data.insurance.policyNumber">{policyNumberText}</Field></dd>

        <dt>保险到期</dt>
        <dd><Field field="data.insurance.expiryDate">{expiryDateText}</Field></dd>

        <dt>保险信息（汇总）</dt>
        <dd>
          <Field field="data.insurance">{`（${policyNumberText} · ${expiryDateText}）`}</Field>
        </dd>

        <dt>最近就诊</dt>
        <dd><Field field="data.lastVisitAt">{lastVisitAtText}</Field></dd>

        <dt>备注</dt>
        <dd><Field field="data.notes">{notesText}</Field></dd>
      </dl>
    </section>
  )
}
