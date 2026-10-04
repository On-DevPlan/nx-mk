/**
 * 新建患者表单 —— 覆盖 POST /patients 201 回显的全部 3 个 manifest 路径
 * （data.id / data.name / data.createdAt），其中 data.createdAt 是对象族最后一条未覆盖路径。
 *
 * P1（分母只算响应字段）：请求体的 NewPatientSchema.name / birthDate **不进分母**
 *   （manifest 里 createPatient 只有 3 条 direction=response 字段）—— 故页面渲染的是
 *   **201 回显对象**而非表单输入。server 的 handler 把写入的 name 原样回显
 *   （server/src/index.ts 的 `name: body.name`），于是 data.name 这一个 normalizedPath
 *   同时承载写路径与读路径 —— 一次 goto 即覆盖 POST 的读写两侧。
 *
 * P1 + generateSdk 丢可空性：生成的 CreatedPatient 三个字段都是非空 string，
 *   TS 不会提醒 null 防护，故兜底是刻意写的（同 PatientDetail 的 notes）。
 *   字符串用 || 而非 ??：对 string 两者等价（仅 '' 分歧，两者都回落 DASH），且与
 *   PatientDetail 的字符串兜底一致；VisitHistory 用 ?? 是因为 number 的 0 是合法
 *   测量值（String(0)='0'），此处不适用。
 *
 * S2（自驱动，DSL 无 click/fill，packages/scenario/src/dsl-schema.ts）：
 *   组件在 mount 时自动提交一次固定表单数据，拿到 201 后渲染回显区。
 *   与 PatientDetail/VisitHistory 靠 main.tsx 多实例覆盖多分支同一 spirit：
 *   页面自驱动，运行期分支不依赖交互，故一次 goto 覆盖整个写路径。
 *
 * A1/A2（空 span → suspicious / 空 textSample → weak）：三个值各过一次 `|| DASH`；
 *   提交中与错误态不渲染任何 Field（空 span 比不渲染更糟：既丢覆盖又进 suspicious 清单）。
 *   与两个 sibling 的早返回不同，本组件用条件渲染保留 section 外壳 ——
 *   「提交中」对用户可见，且回显区未就绪时不至于整块消失。
 *
 * A3（textSample === 字段名末段 → weak）：children 直接取 `created.x || DASH`，
 *   **刻意不引入名为 name / id / createdAt 的局部变量** —— verify-pages.mjs 的 A3
 *   静态近似无法区分「字面量字符串」与「同名标识符引用」，故从结构上避开该碰撞
 *   （siblings 用 xxxText 后缀达到同一目的，这里靠不取同名局部变量）。
 *   运行时取值 'p_<ts>' / 'Bob Li' / ISO 时间串，均 ≠ 'id' / 'name' / 'createdAt'。
 *
 * A4（跨 endpoint 共享最差质量 —— 本文件最关键的一条）：data.id 与 data.name
 *   同时是 getPatient 与 createPatient 两个 endpoint 的 manifest 字段，而 analyzer
 *   按 normalizedPath 单独索引并取最差（coverage-analyzer.ts 的 worstQuality，
 *   键为 ev.fieldPath，无 endpointId）。故**本组件的渲染质量同时决定 PatientDetail
 *   那两条字段的质量** —— 此处任一渲染点判 weak，两个 endpoint 的该字段一起进
 *   weakEvidenceFields。两处 children 分别是 'p_001' / 'p_<ts>' 与 'Alice Chen' /
 *   'Bob Li'，均 valid，无拖累。verify-pages.mjs 的 A3 检查守住这个前提。
 *
 * P3（路径歧义）：data.id 在 GET 与 POST 的响应里都存在。manifest 为二者生成
 *   **不同 fieldId**（派生自 method:path:direction:status:normalizedPath），
 *   故同一个 field 字面量分别命中各自 fieldId —— 页面无需也无法区分，符合预期。
 *
 * StrictMode：开发模式下 React 18 StrictMode 双调用 effect，POST 实际发两次。
 *   server 无持久化（id 由 Date.now() 生成），两次响应都是 valid，取最差后仍 valid；
 *   与 siblings 的双 GET 同性质，不影响 evidence。
 */
import { useEffect, useState } from 'react'
import { Field } from '@nx-mk/client/react'
import { api, type CreatedPatient } from './generated-sdk.js'

/** 空值占位符 —— A1/A2：保证 Field 子节点永不为空串（空 span → suspicious / 空文本 → weak） */
const DASH = '—'

export function NewPatientForm() {
  const [created, setCreated] = useState<CreatedPatient | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // S2 自驱动：mount 即提交固定数据，场景无需 click/fill 即可覆盖写路径
    api.patients
      .createPatient({ body: { name: 'Bob Li', birthDate: '1992-11-03' } })
      .then(setCreated)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <section data-page="new-patient">
      <h2>新建患者（201 回显验证）</h2>
      {error && <p data-page="new-patient-error">提交失败：{error}</p>}
      {!created && !error && <p>提交中…</p>}
      {created && (
        <dl>
          {/* A4：data.id 与 PatientDetail 共享 normalizedPath，两处都必须 valid */}
          <dt>新建编号</dt>
          <dd><Field field="data.id">{created.id || DASH}</Field></dd>

          {/* data.name：请求写入的值在此回显 —— 同一路径同时验证写路径与读路径（A4 共享，见头注） */}
          <dt>登记姓名</dt>
          <dd><Field field="data.name">{created.name || DASH}</Field></dd>

          <dt>登记时间</dt>
          <dd><Field field="data.createdAt">{created.createdAt || DASH}</Field></dd>
        </dl>
      )}
    </section>
  )
}
